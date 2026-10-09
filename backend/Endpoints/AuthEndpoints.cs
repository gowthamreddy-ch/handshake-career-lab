using System.Net.Mail;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Identity;

namespace Handshake.Endpoints;

public static class AuthEndpoints
{
    public static void MapAuthEndpoints(this IEndpointRouteBuilder endpoints, bool demo)
    {
        endpoints.MapGet("/api/session", (
            HttpContext context,
            UserManager<AppUser> users,
            IAntiforgery antiforgery) => GetSession(context, users, antiforgery, demo));

        endpoints.MapPost("/api/auth/register", Register).RequireRateLimiting("auth");
        endpoints.MapPost("/api/auth/login", Login).RequireRateLimiting("auth");
        // Select the result-producing route-handler overload, not RequestDelegate.
        endpoints.MapPost("/api/auth/logout", (Func<HttpContext, Task<IResult>>)Logout);
    }

    private static async Task<IResult> GetSession(
        HttpContext context,
        UserManager<AppUser> users,
        IAntiforgery antiforgery,
        bool demo)
    {
        var user = context.User.Identity?.IsAuthenticated == true
            ? await users.GetUserAsync(context.User)
            : null;
        var token = antiforgery.GetAndStoreTokens(context).RequestToken;

        return Results.Ok(new
        {
            user = user == null ? null : Views.User(user),
            csrfToken = token,
            demo = demo ? new { email = Seed.Email, password = Seed.Password } : null
        });
    }

    private static async Task<IResult> Register(
        RegisterInput input,
        UserManager<AppUser> users,
        SignInManager<AppUser> signIn)
    {
        var name = input.Name?.Trim() ?? "";
        var email = input.Email?.Trim() ?? "";
        var password = input.Password ?? "";

        if (name.Length is < 2 or > 80 || !ValidEmail(email) || password.Length is < 12 or > 128)
        {
            return ApiResponses.Error(400,
                "Provide a name, valid email, and a password of 12–128 characters with uppercase, lowercase, number and symbol.");
        }

        var user = new AppUser
        {
            UserName = email,
            Email = email,
            Name = name
        };
        var created = await users.CreateAsync(user, password);
        if (!created.Succeeded)
        {
            return ApiResponses.Error(400,
                "Registration could not be completed. Use a unique email and a password with uppercase, lowercase, number and symbol.");
        }

        await signIn.SignInAsync(user, false);
        return Results.Json(Views.User(user), statusCode: 201);
    }

    private static async Task<IResult> Login(
        LoginInput input,
        UserManager<AppUser> users,
        SignInManager<AppUser> signIn)
    {
        if (!ValidEmail(input.Email?.Trim() ?? "") || input.Password == null || input.Password.Length > 128)
        {
            return ApiResponses.Error(401, "Email or password is incorrect.");
        }

        var user = await users.FindByEmailAsync(input.Email!.Trim());
        if (user == null)
        {
            return ApiResponses.Error(401, "Email or password is incorrect.");
        }

        var result = await signIn.PasswordSignInAsync(user, input.Password, false, true);
        return result.Succeeded
            ? Results.Ok(Views.User(user))
            : ApiResponses.Error(401, "Email or password is incorrect.");
    }

    private static async Task<IResult> Logout(HttpContext context)
    {
        await context.SignOutAsync(IdentityConstants.ApplicationScheme);
        return Results.NoContent();
    }

    private static bool ValidEmail(string email)
    {
        return email.Length <= 254
            && MailAddress.TryCreate(email, out var address)
            && address.Address == email;
    }
}
