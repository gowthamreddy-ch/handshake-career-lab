using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace Handshake;

public sealed class AppUser : IdentityUser
{
    public string Name { get; set; } = "";
}

public sealed class Job
{
    public int Id { get; set; }
    public string Title { get; set; } = "";
    public string Company { get; set; } = "";
    public string CompanyInitials { get; set; } = "";
    public string Location { get; set; } = "";
    public string WorkMode { get; set; } = "";
    public string Department { get; set; } = "";
    public string EmploymentType { get; set; } = "Internship";
    public int SalaryMin { get; set; }
    public int SalaryMax { get; set; }
    public string Currency { get; set; } = "USD";
    public string SalaryPeriod { get; set; } = "hour";
    public string Description { get; set; } = "";
    public string[] Requirements { get; set; } = [];
    public string[] Skills { get; set; } = [];
    public DateTime PostedAt { get; set; }
    public DateTime ClosesAt { get; set; }
}

public sealed class SavedJob
{
    public string UserId { get; set; } = "";
    public int JobId { get; set; }
    public Job Job { get; set; } = null!;
    public DateTime SavedAt { get; set; } = DateTime.UtcNow;
}

public sealed class Application
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string UserId { get; set; } = "";
    public int JobId { get; set; }
    public Job Job { get; set; } = null!;
    public string Status { get; set; } = "Submitted";
    public string Motivation { get; set; } = "";
    public DateTime SubmittedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    public string IdempotencyKey { get; set; } = "";
    public string Fingerprint { get; set; } = "";
    public List<ApplicationEvent> Events { get; set; } = [];
}

public sealed class ApplicationEvent
{
    public long Id { get; set; }
    public Guid ApplicationId { get; set; }
    public string Status { get; set; } = "";
    public DateTime At { get; set; } = DateTime.UtcNow;
}

public sealed class AppDb(DbContextOptions<AppDb> options) : IdentityDbContext<AppUser>(options)
{
    public DbSet<Job> Jobs => Set<Job>();
    public DbSet<SavedJob> SavedJobs => Set<SavedJob>();
    public DbSet<Application> Applications => Set<Application>();
    public DbSet<ApplicationEvent> ApplicationEvents => Set<ApplicationEvent>();

    protected override void OnModelCreating(ModelBuilder builder)
    {
        base.OnModelCreating(builder);

        builder.Entity<Job>().Property(job => job.Title).HasMaxLength(140);
        builder.Entity<Job>().Property(job => job.Company).HasMaxLength(120);
        builder.Entity<SavedJob>().HasKey(saved => new { saved.UserId, saved.JobId });
        builder.Entity<SavedJob>().HasOne<AppUser>().WithMany().HasForeignKey(saved => saved.UserId);

        // Application ownership and idempotency are separate uniqueness rules.
        // Enforce both in SQLite so concurrent requests cannot bypass API checks.
        builder.Entity<Application>().HasIndex(application => new
        {
            application.UserId,
            application.JobId
        }).IsUnique();
        builder.Entity<Application>().HasIndex(application => new
        {
            application.UserId,
            application.IdempotencyKey
        }).IsUnique();
        builder.Entity<Application>().HasOne<AppUser>().WithMany()
            .HasForeignKey(application => application.UserId);
        builder.Entity<Application>().Property(application => application.Motivation).HasMaxLength(2000);
        builder.Entity<ApplicationEvent>().HasIndex(applicationEvent => new
        {
            applicationEvent.ApplicationId,
            applicationEvent.Status
        }).IsUnique();
        builder.Entity<ApplicationEvent>().HasOne<Application>().WithMany(application => application.Events)
            .HasForeignKey(applicationEvent => applicationEvent.ApplicationId);

        // SQLite stores DateTime without Kind. Every domain timestamp represents
        // UTC; restore its kind on reads to keep replay JSON and browser times stable.
        var utc = new ValueConverter<DateTime, DateTime>(
            value => value.ToUniversalTime(),
            value => DateTime.SpecifyKind(value, DateTimeKind.Utc));
        foreach (var entity in builder.Model.GetEntityTypes())
        {
            foreach (var property in entity.GetProperties())
            {
                if (property.ClrType == typeof(DateTime))
                {
                    property.SetValueConverter(utc);
                }
            }
        }
    }
}

public record LoginInput(string? Email, string? Password);
public record RegisterInput(string? Name, string? Email, string? Password);
public record ApplyInput(int JobId, string? Motivation);

public static class Views
{
    public static object User(AppUser user)
    {
        return new
        {
            id = user.Id,
            name = user.Name,
            email = user.Email
        };
    }

    public static object Application(Application application)
    {
        return new
        {
            id = application.Id,
            job = application.Job,
            status = application.Status,
            motivation = application.Motivation,
            submittedAt = application.SubmittedAt,
            updatedAt = application.UpdatedAt,
            events = application.Events.OrderBy(applicationEvent => applicationEvent.At)
                .Select(applicationEvent => new
                {
                    status = applicationEvent.Status,
                    at = applicationEvent.At
                })
        };
    }
}
