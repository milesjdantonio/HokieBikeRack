package edu.vt.hokiebikerack.racks;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** Request/response shapes for racks and devices. Records = simple immutable data classes. */
public final class RackModels {
  private RackModels() {}

  /**
   * ONLINE / UNCONFIRMED / OFFLINE / WARNING / UNKNOWN, worked out live, see RackService.status().
   * UNCONFIRMED = it went offline and has checked in again, but an admin hasn't confirmed it yet.
   * openAlarms = unhandled tamper alarms (last 24 h). incidentStatus/incidentId = the open police
   * incident (ALERTED, EN_ROUTE, ON_SCENE) or null.
   */
  public record RackSummary(UUID id, String name, String locationDescription, Double latitude, Double longitude,
                            String status, int deviceCount, int onlineDeviceCount, int unconfirmedDeviceCount,
                            Instant lastSeenAt, long openAlerts, long openAlarms, String incidentStatus,
                            UUID incidentId, boolean sensorFault, Instant createdAt) {}

  public record DeviceView(UUID id, UUID rackId, String label, String firmwareVersion, Instant lastSeenAt,
                           boolean online, boolean needsConfirm, boolean active, long authorizationRevision,
                           JsonNode lastHeartbeat, Instant tokenRotatedAt, Instant createdAt) {}

  public record RackDetail(RackSummary rack, List<DeviceView> devices) {}

  /** latitude/longitude are optional, but must be sent together (checked in RackService). */
  public record CreateRack(@NotBlank @Size(max = 120) String name,
                           @Size(max = 255) String locationDescription,
                           @DecimalMin("-90") @DecimalMax("90") Double latitude,
                           @DecimalMin("-180") @DecimalMax("180") Double longitude) {}

  /** clearCoordinates = true takes the rack off the map. */
  public record UpdateRack(@Size(min = 1, max = 120) String name,
                           @Size(max = 255) String locationDescription,
                           @DecimalMin("-90") @DecimalMax("90") Double latitude,
                           @DecimalMin("-180") @DecimalMax("180") Double longitude,
                           Boolean clearCoordinates) {}

  public record CreateDevice(@NotBlank @Size(max = 120) String label) {}

  public record UpdateDevice(@Size(min = 1, max = 120) String label, Boolean active) {}

  /** Returned ONCE when a device is added or its token is rotated. We can't show the token again. */
  public record DeviceCredentials(DeviceView device, String deviceToken, String configSnippet) {}
}
