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

  public record IncidentView(UUID id, UUID rackId, String rackName, String rackLocation, Double latitude,
                             Double longitude, String status, String agency, String alertedBy, Instant alertedAt,
                             String note, Instant updatedAt, Instant resolvedAt) {}

  public record IncidentUpdate(String status, String note, String actor, Instant at) {}

  /** A rack event near the incident (shakes, alarms, taps) for the police timeline. */
  public record RackEvent(UUID id, String eventType, String severity, Instant occurredAt, JsonNode details) {}

  public record IncidentDetail(IncidentView incident, List<IncidentUpdate> updates, List<RackEvent> rackEvents) {}

  public record AlertAuthorities(@Size(max = 500) String note) {}

  public record ChangeStatus(@NotNull Status status, @Size(max = 500) String note) {}
}
