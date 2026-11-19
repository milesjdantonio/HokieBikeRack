package edu.vt.hokiebikerack.events;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** What the events API sends and receives: events from lock modules, and events as the dashboard sees them. */
public final class EventModels {
  private EventModels() {}

  public enum Severity { INFO, LOW, MEDIUM, HIGH, CRITICAL }

  /**
   * One event as a lock module sends it. The Uno prints "[event] ..." lines (firmware/src/main.cpp)
   * and the USB bridge page turns each into one of these (frontend/shared/rack-bridge.js).
   * Jackson rejects an unknown severity before we even get here.
   */
  public record DeviceEvent(
      @NotNull UUID id,
      @NotNull @Pattern(regexp = "[A-Z][A-Z0-9_]{1,47}", message = "must be UPPER_SNAKE_CASE") String eventType,
      @NotNull Severity severity,
      Instant occurredAt,           // null = device clock not set yet
      @PositiveOrZero Long uptimeMs,
      JsonNode details,             // must be a JSON object if present
      @Size(max = 80) String firmwareVersion,
      String deviceId) {}           // ignored: the token decides which device this is

  /** Up to 50 events in one upload. */
  public record DeviceEventBatch(@NotNull @Size(min = 1, max = 50) List<@Valid DeviceEvent> events) {}

  /** accepted = newly stored, duplicates = we already had that event ID (a retry). */
  public record IngestResult(int accepted, int duplicates) {}

  /** An event as the dashboard sees it, with its rack's name and the card's label if registered. */
  public record EventView(UUID id, Instant occurredAt, Instant receivedAt, String timeSource,
                          UUID rackId, String rackName, UUID deviceId, String deviceLabel,
                          String eventType, String severity, JsonNode details,
                          String credentialReference, UUID credentialId, String credentialLabel,
                          Instant acknowledgedAt, String acknowledgedBy, boolean simulated) {}

  /** "Mark All Handled" result: alerts marked handled, and whether an open police incident was resolved. */
  public record RackHandled(int acknowledged, boolean incidentResolved) {}

  /** One page of events, with the total for paging. */
  public record EventPage(List<EventView> items, int page, int size, long total) {}

  /** What to search for; null = any. */
  public record EventFilter(UUID rackId, String severity, String eventType, String credentialReference,
                            Instant from, Instant to, Boolean unacknowledgedOnly) {}
}
