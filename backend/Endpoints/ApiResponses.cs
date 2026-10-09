using System.Security.Claims;

namespace Handshake.Endpoints;

internal static class ApiResponses
{
    public static IResult Error(int status, string error)
    {
        return Results.Json(new { error }, statusCode: status);
    }

    public static string UserId(ClaimsPrincipal user)
    {
        // Protected endpoints obtain ownership from Identity, never request data.
        return user.FindFirstValue(ClaimTypes.NameIdentifier)!;
    }
}
