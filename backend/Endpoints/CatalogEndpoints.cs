using Microsoft.EntityFrameworkCore;

namespace Handshake.Endpoints;

public static class CatalogEndpoints
{
    private static readonly string[] WorkModes = ["Remote", "Hybrid", "On-site"];
    private static readonly string[] Departments = ["Engineering", "Data", "Design", "Operations"];

    public static void MapCatalogEndpoints(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet("/api/jobs", ListJobs);
        endpoints.MapGet("/api/jobs/{id:int}", GetJob);
    }

    private static async Task<IResult> ListJobs(
        string? q,
        string? workMode,
        string? department,
        AppDb db)
    {
        if (q?.Length > 120)
        {
            return ApiResponses.Error(400, "Search must be 120 characters or fewer.");
        }

        if (!string.IsNullOrEmpty(workMode) && !WorkModes.Contains(workMode))
        {
            return ApiResponses.Error(400, "Unknown work mode.");
        }

        if (!string.IsNullOrEmpty(department) && !Departments.Contains(department))
        {
            return ApiResponses.Error(400, "Unknown department.");
        }

        var query = db.Jobs.AsNoTracking().Where(job => job.ClosesAt > DateTime.UtcNow);
        if (!string.IsNullOrEmpty(workMode))
        {
            query = query.Where(job => job.WorkMode == workMode);
        }

        if (!string.IsNullOrEmpty(department))
        {
            query = query.Where(job => job.Department == department);
        }

        // The synthetic catalog is deliberately bounded. Apply exact filters in SQL,
        // then require every literal search token to match the public catalog fields.
        var jobs = await query.OrderByDescending(job => job.PostedAt).ToListAsync();
        var terms = (q ?? "").Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        var items = jobs.Where(job => terms.All(term => SearchText(job)
            .Contains(term, StringComparison.OrdinalIgnoreCase))).ToList();

        return Results.Ok(new
        {
            items,
            total = items.Count,
            dataLabel = "Synthetic demonstration catalog"
        });
    }

    private static async Task<IResult> GetJob(int id, AppDb db)
    {
        var job = await db.Jobs.AsNoTracking().SingleOrDefaultAsync(job => job.Id == id);
        return job == null
            ? ApiResponses.Error(404, "Opportunity not found.")
            : Results.Ok(job);
    }

    private static string SearchText(Job job)
    {
        return string.Join(' ', new[]
        {
            job.Title,
            job.Company,
            job.Location,
            job.Department,
            string.Join(' ', job.Skills)
        });
    }
}
