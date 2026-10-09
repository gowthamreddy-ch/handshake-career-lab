using System.Diagnostics;
using System.Threading.RateLimiting;
using Handshake;
using Handshake.Endpoints;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Routing;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;

// WebRootPath must be supplied when the builder is created; changing it later
// would prevent the combined API + built frontend server from starting.
var startupConfig = new ConfigurationBuilder()
    .AddEnvironmentVariables()
    .AddCommandLine(args)
    .Build();
var frontend = startupConfig["Frontend:Path"];
if (frontend != null && !File.Exists(Path.Combine(frontend, "index.html")))
{
    throw new InvalidOperationException("Build the frontend before specifying Frontend:Path.");
}

var builder = WebApplication.CreateBuilder(new WebApplicationOptions
{
    Args = args,
    WebRootPath = frontend == null ? null : Path.GetFullPath(frontend)
});
var urls = builder.Configuration["urls"] ?? "http://127.0.0.1:4191";
builder.WebHost.UseUrls(urls);

var demo = builder.Configuration.GetValue("Demo:Enabled", builder.Environment.IsDevelopment());
if (demo && urls.Split(';').Any(url =>
    !Uri.TryCreate(url, UriKind.Absolute, out var uri) || !uri.IsLoopback))
{
    throw new InvalidOperationException("Synthetic demo accounts require loopback hosting.");
}

var dbPath = Path.GetFullPath(builder.Configuration["Database:Path"] ?? ".runtime/handshake.sqlite");
Directory.CreateDirectory(Path.GetDirectoryName(dbPath)!);
builder.WebHost.ConfigureKestrel(options => options.Limits.MaxRequestBodySize = 16000);
builder.Configuration["AllowedHosts"] = "localhost;127.0.0.1";

builder.Logging.ClearProviders();
builder.Logging.AddJsonConsole();
builder.Logging.AddFilter("Microsoft", LogLevel.Warning);
builder.Logging.AddFilter("Microsoft.Hosting.Lifetime", LogLevel.Information);

var connectionString = new SqliteConnectionStringBuilder
{
    DataSource = dbPath,
    ForeignKeys = true,
    DefaultTimeout = 15
}.ToString();
builder.Services.AddDbContext<AppDb>(options => options.UseSqlite(connectionString));
builder.Services.AddDataProtection()
    .PersistKeysToFileSystem(new DirectoryInfo(Path.Combine(Path.GetDirectoryName(dbPath)!, "keys")))
    .SetApplicationName("HandshakeCareerLab");

builder.Services.AddIdentityCore<AppUser>(options =>
{
    options.User.RequireUniqueEmail = true;
    options.Password.RequiredLength = 12;
    options.Lockout.MaxFailedAccessAttempts = 5;
    options.Lockout.DefaultLockoutTimeSpan = TimeSpan.FromMinutes(5);
})
    .AddEntityFrameworkStores<AppDb>()
    .AddSignInManager();

var cookieSecurity = builder.Environment.IsDevelopment()
    ? CookieSecurePolicy.SameAsRequest
    : CookieSecurePolicy.Always;
builder.Services.AddAuthentication(IdentityConstants.ApplicationScheme)
    .AddCookie(IdentityConstants.ApplicationScheme, options =>
    {
        options.Cookie.Name = "handshake_session";
        options.Cookie.HttpOnly = true;
        options.Cookie.SameSite = SameSiteMode.Strict;
        options.Cookie.SecurePolicy = cookieSecurity;
        options.ExpireTimeSpan = TimeSpan.FromHours(4);
        options.SlidingExpiration = false;
        options.Events.OnRedirectToLogin = context =>
        {
            context.Response.StatusCode = 401;
            return context.Response.WriteAsJsonAsync(new { error = "Sign in to continue." });
        };
        options.Events.OnRedirectToAccessDenied = context =>
        {
            context.Response.StatusCode = 403;
            return context.Response.WriteAsJsonAsync(new { error = "Access denied." });
        };
    });
builder.Services.AddAuthorization();
builder.Services.AddAntiforgery(options =>
{
    options.HeaderName = "X-CSRF-TOKEN";
    options.Cookie.Name = "handshake_csrf";
    options.Cookie.HttpOnly = true;
    options.Cookie.SameSite = SameSiteMode.Strict;
    options.Cookie.SecurePolicy = cookieSecurity;
});
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = 429;
    options.AddPolicy("auth", context => RateLimitPartition.GetFixedWindowLimiter(
        context.Connection.RemoteIpAddress?.ToString() ?? "local",
        _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 30,
            Window = TimeSpan.FromMinutes(1),
            QueueLimit = 0
        }));
    options.OnRejected = (context, cancellationToken) =>
    {
        context.HttpContext.Response.Headers.RetryAfter = "60";
        return new ValueTask(context.HttpContext.Response.WriteAsJsonAsync(
            new { error = "Too many sign-in attempts. Try again in a minute." },
            cancellationToken));
    };
});

var app = builder.Build();
await Seed.Run(app.Services, demo);

app.Use(async (context, next) =>
{
    var started = Stopwatch.GetTimestamp();
    context.Response.Headers.XContentTypeOptions = "nosniff";
    context.Response.Headers.XFrameOptions = "DENY";
    context.Response.Headers["Referrer-Policy"] = "strict-origin-when-cross-origin";
    if (context.Request.Path.StartsWithSegments("/api"))
    {
        context.Response.Headers.CacheControl = "no-store";
    }
    else
    {
        context.Response.Headers["Content-Security-Policy"] =
            "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; " +
            "connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'";
    }

    try
    {
        await next();
    }
    catch (BadHttpRequestException)
    {
        if (!context.Response.HasStarted)
        {
            context.Response.StatusCode = 400;
            await context.Response.WriteAsJsonAsync(new { error = "Invalid request body." });
        }
    }
    catch (Exception exception)
    {
        // Log the exception type, not messages that could contain submitted data.
        app.Logger.LogError("Request failed {ErrorType} {TraceId}",
            exception.GetType().Name, context.TraceIdentifier);
        if (!context.Response.HasStarted)
        {
            context.Response.StatusCode = 500;
            await context.Response.WriteAsJsonAsync(new
            {
                error = "The request could not be completed. Please try again."
            });
        }
    }
    finally
    {
        // Route templates contain placeholders, never job/application IDs. Do not
        // log request paths, queries, bodies, cookies, headers, or account details.
        var routeTemplate = (context.GetEndpoint() as RouteEndpoint)?.RoutePattern.RawText
            ?? "unmatched-or-static";
        var method = context.Request.Method switch
        {
            "GET" or "HEAD" or "POST" or "PUT" or "PATCH" or "DELETE" or "OPTIONS" => context.Request.Method,
            _ => "OTHER"
        };
        app.Logger.LogInformation(
            "HTTP {Method} {RouteTemplate} responded {StatusCode} in {ElapsedMs} ms {TraceId}",
            method,
            routeTemplate,
            context.Response.StatusCode,
            Math.Round(Stopwatch.GetElapsedTime(started).TotalMilliseconds, 2),
            context.TraceIdentifier);
    }
});

app.UseAuthentication();
app.UseAuthorization();
app.UseRateLimiter();
app.Use(async (context, next) =>
{
    var isApiMutation = context.Request.Path.StartsWithSegments("/api")
        && !HttpMethods.IsGet(context.Request.Method)
        && !HttpMethods.IsHead(context.Request.Method);
    if (isApiMutation)
    {
        try
        {
            var antiforgery = context.RequestServices.GetRequiredService<IAntiforgery>();
            await antiforgery.ValidateRequestAsync(context);
        }
        catch (AntiforgeryValidationException)
        {
            context.Response.StatusCode = 403;
            await context.Response.WriteAsJsonAsync(new
            {
                error = "Your session changed. Refresh the page and try again."
            });
            return;
        }
    }

    await next();
});

app.MapGet("/api/health", () => Results.Ok(new { service = "Handshake Career Lab", ok = true }));
app.MapAuthEndpoints(demo);
app.MapCatalogEndpoints();
app.MapStudentEndpoints();
app.Map("/api/{**path}", () => ApiResponses.Error(404, "API endpoint not found."));

if (frontend != null && Directory.Exists(frontend))
{
    app.UseDefaultFiles();
    app.UseStaticFiles();
    app.MapFallbackToFile("index.html");
}

app.Run();

public partial class Program;
