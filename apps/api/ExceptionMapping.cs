using JourneyBook.Application.Locations;
using JourneyBook.Application.Projects;
using JourneyBook.Application.TileSources;

namespace JourneyBook.Api;

/// <summary>
/// Maps an unhandled exception to the status code and client-visible message the
/// API should answer with.
///
/// <para>
/// The API had no exception handler at all, so ordinary bad input reached the
/// host as a 500 — <c>PUT /api/generated-pdfs/{id}/status</c> with an unknown
/// status threw <see cref="ArgumentException"/> out of
/// <c>GeneratedPdfService.ParseStatus</c> and returned a 500 carrying a full
/// stack trace under the Development profile that Compose used to default to.
/// Individual endpoints caught their own validation exceptions, but only the
/// ones whose authors thought of it, and only the type they thought of.
/// </para>
///
/// <para>
/// Kept as a pure function so the mapping is unit-testable without a host, a
/// database or a Docker daemon — the integration suites that exercise the
/// endpoints need Testcontainers, which is exactly why the gap survived.
/// </para>
/// </summary>
public static class ExceptionMapping
{
    /// <summary>Generic 500 text. Deliberately says nothing about the failure.</summary>
    public const string UnexpectedMessage = "An unexpected error occurred.";

    /// <summary>
    /// The status and message for <paramref name="exception"/>.
    ///
    /// <para>
    /// The validation exception types are the Application layer's own vocabulary
    /// for "the caller got this wrong", and their messages are written to be read
    /// by a user ("Unknown scale preset 'foo'."), so they are echoed. Everything
    /// else is a 500 whose message is <b>discarded</b>: an arbitrary exception
    /// message is an internal detail (connection strings, file paths, SQL) and
    /// must not cross the wire just because the exception escaped.
    /// </para>
    /// </summary>
    public static (int Status, string Message) Map(Exception exception) => exception switch
    {
        // Application-layer validation: the caller's input is wrong.
        LocationValidationException => (StatusCodes.Status400BadRequest, exception.Message),
        ProjectValidationException => (StatusCodes.Status400BadRequest, exception.Message),

        // Conflict, not bad input: the existing endpoint already answers 409 for a
        // duplicate tile-source key, and the handler must not disagree with it.
        TileSourceValidationException => (StatusCodes.Status409Conflict, exception.Message),

        // A URL the egress policy will never fetch is bad input, not a conflict.
        TileSourceUrlPolicyException => (StatusCodes.Status400BadRequest, exception.Message),

        // Thrown by enum/string parsing on request DTOs (e.g. an unknown PDF status).
        // ArgumentNullException is a null the caller could not have supplied through
        // model binding — that is our bug, so it falls through to 500 below.
        ArgumentNullException => (StatusCodes.Status500InternalServerError, UnexpectedMessage),
        ArgumentException => (StatusCodes.Status400BadRequest, exception.Message),

        // Malformed JSON / unbindable route or query values.
        BadHttpRequestException bad => (bad.StatusCode, "Malformed request."),

        _ => (StatusCodes.Status500InternalServerError, UnexpectedMessage),
    };
}
