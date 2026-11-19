package edu.vt.hokiebikerack.incidents;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** Police incidents ("Alert Authorities"). See docs/notes/roles-plan.md. */
public final class IncidentModels {
  private IncidentModels() {}

  /** In order: a step can only move forward. */
  public enum Status { ALERTED, EN_ROUTE, ON_SCENE, RESOLVED }

  /** An incident with where its rack is. */
  public record IncidentView(UUID id, UUID rackId, String rackName, String rackLocation, Double latitude,
                             Double longitude, String status, String agency, String alertedBy, Instant alertedAt,
                             String note, Instant updatedAt, Instant resolvedAt) {}

  /** One step in an incident's timeline: who moved it to which status, when. */
  public record IncidentUpdate(String status, String note, String actor, Instant at) {}

  /** A rack event near the incident (shakes, alarms, taps) for the police timeline. */
  public record RackEvent(UUID id, String eventType, String severity, Instant occurredAt, JsonNode details) {}

  /** An incident, its timeline, and what the rack saw around it. */
  public record IncidentDetail(IncidentView incident, List<IncidentUpdate> updates, List<RackEvent> rackEvents) {}

  /** Body of Alert Authorities: an optional note for the police. */
  public record AlertAuthorities(@Size(max = 500) String note) {}

  /** Body of a police status change: the new status and an optional note. */
  public record ChangeStatus(@NotNull Status status, @Size(max = 500) String note) {}
}
