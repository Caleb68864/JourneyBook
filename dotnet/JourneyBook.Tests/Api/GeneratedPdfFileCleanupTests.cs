using System.Net;
using System.Net.Http.Json;
using JourneyBook.Application.GeneratedPdfs;
using JourneyBook.Application.Projects;
using JourneyBook.Infrastructure.GeneratedPdfs;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.DependencyInjection;

namespace JourneyBook.Tests.Api;

/// <summary>
/// Deleting a generated-PDF record, or the project that owns it, deletes the PDF on disk.
/// Both used to remove rows only (the project's by database cascade), leaving every file on
/// the shared volume with nothing left to reclaim it: retention finds files through rows.
/// </summary>
public class GeneratedPdfFileCleanupTests(GeneratedDirApiFactory factory) : IClassFixture<GeneratedDirApiFactory>
{
    private readonly HttpClient _client = factory.CreateClient();

    private async Task<Guid> ProjectAsync(string name)
    {
        var post = await _client.PostAsJsonAsync("/api/projects", new CreateProjectRequest(name, "usgs-7-5-min"));
        return (await post.Content.ReadFromJsonAsync<ProjectResponse>())!.Id;
    }

    /// <summary>A record in <paramref name="status"/> pointing at a real file under the generated dir.</summary>
    private async Task<(Guid Id, string File)> RecordWithFileAsync(Guid projectId, string status)
    {
        var post = await _client.PostAsJsonAsync($"/api/projects/{projectId}/generated-pdfs", new CreateGeneratedPdfRequest());
        var row = (await post.Content.ReadFromJsonAsync<GeneratedPdfResponse>())!;
        var name = $"atlas-{row.Id:N}.pdf";
        Directory.CreateDirectory(factory.GeneratedDir);
        var full = Path.Combine(factory.GeneratedDir, name);
        await File.WriteAllTextAsync(full, "%PDF-1.7 test");
        var put = await _client.PutAsJsonAsync($"/api/generated-pdfs/{row.Id}/status",
            new UpdateGeneratedPdfStatusRequest(status, name));
        Assert.Equal(HttpStatusCode.OK, put.StatusCode);
        return (row.Id, full);
    }

    [Fact]
    public async Task Deleting_a_record_deletes_its_file()
    {
        var (id, file) = await RecordWithFileAsync(await ProjectAsync("Delete one"), "Completed");

        var del = await _client.DeleteAsync($"/api/generated-pdfs/{id}");

        Assert.Equal(HttpStatusCode.NoContent, del.StatusCode);
        Assert.False(File.Exists(file), "the PDF outlived its record");
    }

    [Fact]
    public async Task Deleting_a_project_deletes_its_records_files()
    {
        var projectId = await ProjectAsync("Delete project");
        var (_, completed) = await RecordWithFileAsync(projectId, "Completed");
        var (_, failed) = await RecordWithFileAsync(projectId, "Failed");
        var (_, other) = await RecordWithFileAsync(await ProjectAsync("Bystander"), "Completed");

        var del = await _client.DeleteAsync($"/api/projects/{projectId}");

        Assert.Equal(HttpStatusCode.NoContent, del.StatusCode);
        Assert.False(File.Exists(completed), "a deleted project's PDF stayed on disk");
        Assert.False(File.Exists(failed), "a deleted project's Failed-but-finished PDF stayed on disk");
        // Control: only that project's files.
        Assert.True(File.Exists(other), "deleting one project removed another project's PDF");
    }

    /// <summary>
    /// A render stranded by a crash: its row says Rendering and names its file, and what is on
    /// disk is a partial write nobody will finish. Reconciliation used to fail the row and leave
    /// the file.
    /// </summary>
    [Fact]
    public async Task Crash_reconciliation_removes_a_stranded_renders_partial_file()
    {
        var projectId = await ProjectAsync("Crash partial");
        var (stranded, partial) = await RecordWithFileAsync(projectId, "Rendering");
        var (_, finished) = await RecordWithFileAsync(projectId, "Completed");

        using (var scope = factory.Services.CreateScope())
        {
            await scope.ServiceProvider.GetRequiredService<IGeneratedPdfService>()
                .FailStrandedAsync("stranded by test");
        }

        Assert.False(File.Exists(partial), "a crash-stranded partial PDF stayed on disk");
        // Control: a finished render is not wreckage.
        Assert.True(File.Exists(finished));
        var row = await _client.GetFromJsonAsync<GeneratedPdfResponse>($"/api/generated-pdfs/{stranded}");
        Assert.Equal("Failed", row!.Status);
        Assert.Null(row.FilePath);
    }

    /// <summary>
    /// The folder sweep: a PDF no record points at, older than the safe age, goes. Everything
    /// that might still be wanted stays.
    /// </summary>
    [Fact]
    public async Task The_orphan_sweep_removes_only_old_unreferenced_atlas_files()
    {
        Directory.CreateDirectory(factory.GeneratedDir);
        var old = DateTime.UtcNow.AddDays(-3);
        string Put(string name, DateTime written)
        {
            var path = Path.Combine(factory.GeneratedDir, name);
            File.WriteAllText(path, "%PDF");
            File.SetLastWriteTimeUtc(path, written);
            return path;
        }

        var orphan = Put($"atlas-{Guid.NewGuid():N}.pdf", old);
        var youngOrphan = Put($"atlas-{Guid.NewGuid():N}.pdf", DateTime.UtcNow);
        var notOurs = Put("field-notes.pdf", old);
        var nested = Path.Combine(factory.GeneratedDir, "keep");
        Directory.CreateDirectory(nested);
        var nestedFile = Path.Combine(nested, $"atlas-{Guid.NewGuid():N}.pdf");
        File.WriteAllText(nestedFile, "%PDF");
        File.SetLastWriteTimeUtc(nestedFile, old);

        // A record that points at its file, and a queued record that has not recorded one yet.
        var projectId = await ProjectAsync("Sweep host");
        var (_, referenced) = await RecordWithFileAsync(projectId, "Completed");
        File.SetLastWriteTimeUtc(referenced, old);
        var post = await _client.PostAsJsonAsync($"/api/projects/{projectId}/generated-pdfs", new CreateGeneratedPdfRequest());
        var queued = (await post.Content.ReadFromJsonAsync<GeneratedPdfResponse>())!;
        var queuedFile = Put($"atlas-{queued.Id:N}.pdf", old);

        int removed;
        using (var scope = factory.Services.CreateScope())
        {
            removed = await scope.ServiceProvider.GetRequiredService<GeneratedPdfOrphanSweeper>()
                .SweepAsync(TimeSpan.FromHours(24));
        }

        Assert.Equal(1, removed);
        Assert.False(File.Exists(orphan), "an old PDF no record points at was kept");
        Assert.True(File.Exists(youngOrphan), "a file younger than the safe age was deleted");
        Assert.True(File.Exists(notOurs), "a file not named like an atlas was deleted");
        Assert.True(File.Exists(nestedFile), "a file outside the top level was deleted");
        Assert.True(File.Exists(referenced), "a file a record points at was deleted");
        Assert.True(File.Exists(queuedFile), "a queued render's file was deleted");
    }

    [Fact]
    public void The_orphan_sweep_is_off_unless_configured()
    {
        var options = factory.Services.GetRequiredService<JourneyBook.Infrastructure.GeneratedPdfs.GeneratedPdfRetentionOptions>();
        Assert.False(options.SweepsOrphans);
    }
}

/// <summary><see cref="PostgisApiFactory"/> with its own throwaway generated dir.</summary>
public class GeneratedDirApiFactory : PostgisApiFactory
{
    public string GeneratedDir { get; } = Path.Combine(Path.GetTempPath(), "jb-gen-cleanup-" + Guid.NewGuid().ToString("N"));

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        base.ConfigureWebHost(builder);
        builder.UseSetting("GeneratedPdf:GeneratedDir", GeneratedDir);
    }

    public override async ValueTask DisposeAsync()
    {
        await base.DisposeAsync();
        if (Directory.Exists(GeneratedDir)) Directory.Delete(GeneratedDir, recursive: true);
    }
}
