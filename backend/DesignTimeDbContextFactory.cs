using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace Handshake;

// Migration tooling must not start the HTTP server or seed demo accounts.
public sealed class DesignTimeDbContextFactory : IDesignTimeDbContextFactory<AppDb>
{
    public AppDb CreateDbContext(string[] args) => new(
        new DbContextOptionsBuilder<AppDb>().UseSqlite("Data Source=.runtime/design.sqlite").Options);
}
