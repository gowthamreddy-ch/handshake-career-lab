using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;

namespace Handshake.Endpoints;

public static class StudentEndpoints
{
    private const string DuplicateApplication = "You already have an application for this opportunity.";

    public static void MapStudentEndpoints(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet("/api/saved", ListSavedJobs).RequireAuthorization();
        endpoints.MapPut("/api/saved/{id:int}", SaveJob).RequireAuthorization();
        endpoints.MapDelete("/api/saved/{id:int}", RemoveSavedJob).RequireAuthorization();
        endpoints.MapGet("/api/applications", ListApplications).RequireAuthorization();
        endpoints.MapPost("/api/applications", Apply).RequireAuthorization();
        endpoints.MapPost("/api/applications/{id:guid}/withdraw", Withdraw).RequireAuthorization();
    }

    private static async Task<IResult> ListSavedJobs(ClaimsPrincipal user, AppDb db)
    {
        var userId = ApiResponses.UserId(user);
        var items = await db.SavedJobs.AsNoTracking()
            .Where(saved => saved.UserId == userId)
            .OrderByDescending(saved => saved.SavedAt)
            .Select(saved => saved.Job)
            .ToListAsync();

        return Results.Ok(new { items });
    }

    private static async Task<IResult> SaveJob(int id, ClaimsPrincipal user, AppDb db)
    {
        var available = await db.Jobs.AnyAsync(job => job.Id == id && job.ClosesAt > DateTime.UtcNow);
        if (!available)
        {
            return ApiResponses.Error(404, "Opportunity is unavailable.");
        }

        var userId = ApiResponses.UserId(user);
        // The composite primary key resolves concurrent saves in the database.
        // Interpolated SQL is parameterized by EF Core, including both identifiers.
        var inserted = await db.Database.ExecuteSqlInterpolatedAsync(
            $"INSERT OR IGNORE INTO SavedJobs (UserId, JobId, SavedAt) VALUES ({userId}, {id}, {DateTime.UtcNow})");

        return Results.Json(new { saved = true }, statusCode: inserted == 1 ? 201 : 200);
    }

    private static async Task<IResult> RemoveSavedJob(int id, ClaimsPrincipal user, AppDb db)
    {
        var userId = ApiResponses.UserId(user);
        await db.SavedJobs
            .Where(saved => saved.UserId == userId && saved.JobId == id)
            .ExecuteDeleteAsync();

        return Results.NoContent();
    }

    private static async Task<IResult> ListApplications(ClaimsPrincipal user, AppDb db)
    {
        var userId = ApiResponses.UserId(user);
        var applications = await db.Applications.AsNoTracking()
            .Include(application => application.Job)
            .Include(application => application.Events)
            .Where(application => application.UserId == userId)
            .OrderByDescending(application => application.SubmittedAt)
            .ToListAsync();

        return Results.Ok(new { items = applications.Select(Views.Application) });
    }

    private static async Task<IResult> Apply(ApplyInput input, HttpContext context, AppDb db)
    {
        var key = context.Request.Headers["Idempotency-Key"].ToString();
        var motivation = input.Motivation?.Trim() ?? "";
        if (!Guid.TryParse(key, out _) || motivation.Length is < 50 or > 2000)
        {
            return ApiResponses.Error(400,
                "Provide a valid submission key and a motivation of 50–2000 characters.");
        }

        var userId = ApiResponses.UserId(context.User);
        var fingerprint = Convert.ToHexString(SHA256.HashData(
            Encoding.UTF8.GetBytes($"{input.JobId}\n{motivation}")));
        var existing = await ReplayApplication(db, userId, key, fingerprint);
        if (existing != null)
        {
            return existing;
        }

        var job = await db.Jobs.SingleOrDefaultAsync(job =>
            job.Id == input.JobId && job.ClosesAt > DateTime.UtcNow);
        if (job == null)
        {
            return ApiResponses.Error(404, "Opportunity is unavailable.");
        }

        if (await db.Applications.AnyAsync(application =>
            application.UserId == userId && application.JobId == job.Id))
        {
            // A matching request may have committed since the first replay lookup.
            // Recheck its key before treating this as a different, duplicate request.
            return await ReplayApplication(db, userId, key, fingerprint)
                ?? ApiResponses.Error(409, DuplicateApplication);
        }

        var application = new Application
        {
            UserId = userId,
            JobId = job.Id,
            Job = job,
            Motivation = motivation,
            IdempotencyKey = key,
            Fingerprint = fingerprint,
            Events = [new ApplicationEvent { Status = "Submitted" }]
        };
        db.Applications.Add(application);

        try
        {
            // SaveChanges commits the application and initial event together.
            await db.SaveChangesAsync();
        }
        catch (DbUpdateException exception)
            when (exception.InnerException is SqliteException { SqliteErrorCode: 19 })
        {
            // Database uniqueness handles a competitor that wins after our checks.
            // Drop the failed insert before reading the committed winning record.
            db.ChangeTracker.Clear();
            return await ReplayApplication(db, userId, key, fingerprint)
                ?? ApiResponses.Error(409, DuplicateApplication);
        }

        return Results.Json(Views.Application(application), statusCode: 201);
    }

    private static async Task<IResult?> ReplayApplication(
        AppDb db,
        string userId,
        string key,
        string fingerprint)
    {
        var prior = await db.Applications.AsNoTracking()
            .Include(application => application.Job)
            .Include(application => application.Events)
            .SingleOrDefaultAsync(application =>
                application.UserId == userId && application.IdempotencyKey == key);

        if (prior == null)
        {
            return null;
        }

        return prior.Fingerprint == fingerprint
            ? Results.Ok(Views.Application(prior))
            : ApiResponses.Error(409, "This submission key was already used for a different application.");
    }

    private static async Task<IResult> Withdraw(Guid id, ClaimsPrincipal user, AppDb db)
    {
        var userId = ApiResponses.UserId(user);
        await using var transaction = await db.Database.BeginTransactionAsync();

        // A conditional update claims the transition once. The event is committed
        // in the same transaction, so retries cannot add another withdrawal event.
        var changed = await db.Applications
            .Where(application => application.Id == id
                && application.UserId == userId
                && application.Status == "Submitted")
            .ExecuteUpdateAsync(setters => setters
                .SetProperty(application => application.Status, "Withdrawn")
                .SetProperty(application => application.UpdatedAt, DateTime.UtcNow));

        var application = await db.Applications
            .Include(application => application.Job)
            .Include(application => application.Events)
            .SingleOrDefaultAsync(application => application.Id == id && application.UserId == userId);
        if (application == null)
        {
            return ApiResponses.Error(404, "Application not found.");
        }

        if (changed == 1)
        {
            application.Events.Add(new ApplicationEvent
            {
                ApplicationId = id,
                Status = "Withdrawn"
            });
            await db.SaveChangesAsync();
        }

        await transaction.CommitAsync();
        return Results.Ok(Views.Application(application));
    }
}
