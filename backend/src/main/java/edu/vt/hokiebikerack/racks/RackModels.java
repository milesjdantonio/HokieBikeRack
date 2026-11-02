package edu.vt.hokiebikerack.racks;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** Request/response shapes for racks and devices. Records = simple immutable data classes. */
public final class RackModels {
  private RackModels() {}

  /** ONLINE / OFFLINE / WARNING / UNKNOWN — worked out live, see RackService.status(). */
  public record RackSummary(UUID id, String name, String locationDescription, String status,
                            int deviceCount, int onlineDeviceCount, Instant lastSeenAt,
                            long openAlerts, boolean sensorFault, Instant createdAt) {}

  public record DeviceView(UUID id, UUID rackId, String label, String firmwareVersion, Instant lastSeenAt,
                           boolean online, boolean active, long authorizationRevision,
                           JsonNode lastHeartbeat, Instant tokenRotatedAt, Instant createdAt) {}

  public record RackDetail(RackSummary rack, List<DeviceView> devices) {}

  public record CreateRack(@NotBlank @Size(max = 120) String name,
                           @Size(max = 255) String locationDescription) {}

  public record UpdateRack(@Size(min = 1, max = 120) String name,
                           @Size(max = 255) String locationDescription) {}

  public record CreateDevice(@NotBlank @Size(max = 120) String label) {}

  public record UpdateDevice(@Size(min = 1, max = 120) String label, Boolean active) {}

  /** Returned ONCE when a device is added or its token is rotated. We can't show the token again. */
  public record DeviceCredentials(DeviceView device, String deviceToken, String configSnippet) {}
}
