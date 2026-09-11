using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace JourneyBook.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddGeneratedPdfProgress : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "PageCount",
                table: "GeneratedPdfs",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "Progress",
                table: "GeneratedPdfs",
                type: "integer",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "PageCount",
                table: "GeneratedPdfs");

            migrationBuilder.DropColumn(
                name: "Progress",
                table: "GeneratedPdfs");
        }
    }
}
