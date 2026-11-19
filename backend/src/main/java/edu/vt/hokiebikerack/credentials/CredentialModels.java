package edu.vt.hokiebikerack.credentials;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** What the cards API sends and receives (JSON shapes). @Valid checks run on the request ones. */
public final class CredentialModels {
  private CredentialModels() {}

  /**
   * status is worked out from the fields: ACTIVE, DISABLED, REVOKED, EXPIRED, NOT_YET_VALID.
   * lastUsedAt = last ACCESS_GRANTED event for this card.
   */
  public record CredentialView(UUID id, String credentialReference, String displayLabel, String status,
                               boolean active, boolean allRacks, List<UUID> rackIds,
                               Instant validFrom, Instant validUntil, Instant createdAt, Instant updatedAt,
                               Instant revokedAt, Instant lastUsedAt, long grantedCount,
                               String riderName) {}   // null = no rider code made for this card yet

  /** The reference comes from an ACCESS_DENIED event (tap-then-register) or the serial monitor. */
  public record CreateCredential(
      @NotBlank @Pattern(regexp = "[0-9a-fA-F]{64}", message = "must be 64 hex characters") String credentialReference,
      @NotBlank @Size(max = 120) String displayLabel,
      boolean allRacks,
      List<UUID> rackIds,
      Instant validFrom,
      Instant validUntil) {}

  /** Every field optional: only the ones you send change. clearValidFrom/Until remove a date. */
  public record UpdateCredential(
      @Size(min = 1, max = 120) String displayLabel,
      Boolean active,
      Boolean allRacks,
      List<UUID> rackIds,
      Instant validFrom,
      Instant validUntil,
      Boolean clearValidFrom,
      Boolean clearValidUntil) {}

  /** A card someone tapped that isn't registered yet. */
  public record UnknownCard(String credentialReference, Instant lastSeenAt, long attempts,
                            UUID lastRackId, String lastRackName) {}
}
