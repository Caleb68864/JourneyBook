using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace JourneyBook.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddLocationPin : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "PinColor",
                table: "ImportantLocations",
                type: "character varying(9)",
                maxLength: 9,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "PinShape",
                table: "ImportantLocations",
                type: "character varying(20)",
                maxLength: 20,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "PinColor",
                table: "ImportantLocations");

            migrationBuilder.DropColumn(
                name: "PinShape",
                table: "ImportantLocations");
        }
    }
}
