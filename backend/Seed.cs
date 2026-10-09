using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace Handshake;

public static class Seed
{
    public const string Email = "maya@demo.handshake.test";
    public const string Password = "HandshakeDemo2026!";

    public static async Task Run(IServiceProvider services, bool demo)
    {
        using var scope = services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDb>();
        await db.Database.MigrateAsync();

        if (!await db.Jobs.AnyAsync())
        {
            await SeedJobs(db);
        }

        if (demo)
        {
            var users = scope.ServiceProvider.GetRequiredService<UserManager<AppUser>>();
            await SeedDemoStudent(users);
        }
    }

    private static async Task SeedJobs(AppDb db)
    {
        var specs = new (string Title, string Company, string Initials, string Location,
            string Mode, string Department, int Min, int Max, string[] Skills)[]
        {
            ("Software Engineering Intern", "Canopy Systems", "CS", "Austin, TX",
                "Hybrid", "Engineering", 28, 36, ["C#", ".NET", "SQL"]),
            ("Product Analytics Intern", "Lumen Data", "LD", "United States",
                "Remote", "Data", 26, 32, ["SQL", "Python", "Analytics"]),
            ("UX Research Intern", "Fieldnote Studio", "FS", "Boston, MA",
                "Hybrid", "Design", 24, 30, ["Research", "Prototyping", "Figma"]),
            ("Backend Engineering Intern", "Northstar Labs", "NL", "Seattle, WA",
                "On-site", "Engineering", 30, 38, ["TypeScript", "APIs", "PostgreSQL"]),
            ("Business Operations Intern", "Juniper Works", "JW", "United States",
                "Remote", "Operations", 22, 28, ["Excel", "Process mapping", "Communication"]),
            ("Data Engineering Intern", "Tidal Analytics", "TA", "Chicago, IL",
                "Hybrid", "Data", 29, 35, ["Python", "SQL", "Data pipelines"]),
            ("Frontend Engineering Intern", "Paperkite", "PK", "New York, NY",
                "Hybrid", "Engineering", 27, 34, ["React", "TypeScript", "Accessibility"]),
            ("Product Design Intern", "Morrow Digital", "MD", "United States",
                "Remote", "Design", 25, 31, ["Figma", "Interaction design", "Design systems"]),
            ("Quality Engineering Intern", "Harbor Software", "HS", "Dallas, TX",
                "On-site", "Engineering", 25, 32, ["Testing", "C#", "Automation"]),
            ("Customer Insights Intern", "Cedar Research", "CR", "Denver, CO",
                "Hybrid", "Data", 23, 29, ["Statistics", "SQL", "Storytelling"]),
            ("Technical Operations Intern", "Acorn Cloud", "AC", "United States",
                "Remote", "Operations", 24, 30, ["Linux", "Documentation", "Monitoring"]),
            ("Mobile Engineering Intern", "Daybreak Apps", "DA", "San Diego, CA",
                "On-site", "Engineering", 28, 35, ["React Native", "TypeScript", "Testing"])
        };

        var id = 0;
        foreach (var spec in specs)
        {
            id++;
            db.Jobs.Add(new Job
            {
                Id = id,
                Title = spec.Title,
                Company = spec.Company,
                CompanyInitials = spec.Initials,
                Location = spec.Location,
                WorkMode = spec.Mode,
                Department = spec.Department,
                SalaryMin = spec.Min,
                SalaryMax = spec.Max,
                Skills = spec.Skills,
                Description = $"Join the fictional {spec.Company} team for a paid, 12-week learning-focused internship. " +
                    $"Work with a mentor on a scoped {spec.Department.ToLowerInvariant()} project, " +
                    "share your progress in weekly reviews, and document the decisions behind your work. " +
                    "This role is synthetic and does not accept real employment applications.",
                Requirements =
                [
                    "Currently studying or recently completed a related degree or equivalent learning program.",
                    $"Some hands-on practice with {string.Join(", ", spec.Skills.Take(2))}; coursework and personal projects count.",
                    "Able to explain your work, ask questions, and collaborate with a mentor."
                ],
                PostedAt = DateTime.UtcNow.Date.AddDays(-id),
                ClosesAt = DateTime.UtcNow.Date.AddDays(30 + id)
            });
        }

        await db.SaveChangesAsync();
    }

    private static async Task SeedDemoStudent(UserManager<AppUser> users)
    {
        if (await users.FindByEmailAsync(Email) != null)
        {
            return;
        }

        var user = new AppUser
        {
            UserName = Email,
            Email = Email,
            Name = "Maya Chen",
            EmailConfirmed = true
        };
        var result = await users.CreateAsync(user, Password);
        if (!result.Succeeded)
        {
            throw new InvalidOperationException("Demo account could not be seeded.");
        }
    }
}
