package edu.vt.hokiebikerack;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.httpBasic;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.request.RequestPostProcessor;

/**
 * End-to-end API tests against a REAL PostgreSQL (started automatically).
 * Each test creates its own rack/device so tests don't depend on each other.
 * Run with: mvn test
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles({"embedded", "test"})
class ApiIntegrationTest {
  private static final RequestPostProcessor ADMIN = httpBasic("admin", "test-admin-pass");
  private static final RequestPostProcessor VIEWER = httpBasic("viewer", "test-viewer-pass");

  @Autowired MockMvc mvc;
  @Autowired ObjectMapper mapper;
  @Autowired JdbcClient jdbc;

  // ---------- helpers ----------

  private JsonNode json(MockHttpServletRequestBuilder req, int expectedStatus) throws Exception {
    String body = mvc.perform(req).andExpect(status().is(expectedStatus))
        .andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);
    return body.isEmpty() ? null : mapper.readTree(body);
  }

  private MockHttpServletRequestBuilder jsonBody(MockHttpServletRequestBuilder req, String body) {
    return req.contentType(MediaType.APPLICATION_JSON).content(body);
  }

  record Device(String rackId, String deviceId, String token) {}

  private Device newRackWithDevice(String name) throws Exception {
    JsonNode rack = json(jsonBody(post("/api/v1/racks"), "{\"name\":\"" + name + "\"}").with(ADMIN), 201);
    String rackId = rack.at("/rack/id").asText();
    JsonNode dev = json(jsonBody(post("/api/v1/racks/" + rackId + "/devices"), "{\"label\":\"esp32\"}")
        .with(ADMIN), 201);
    return new Device(rackId, dev.at("/device/id").asText(), dev.get("deviceToken").asText());
  }

  private MockHttpServletRequestBuilder asDevice(MockHttpServletRequestBuilder req, Device d) {
    return req.header("Authorization", "Bearer " + d.token());
  }

  /** Same formula as the firmware (credential_ref.cpp) and the simulator. */
  static String credentialRef(String cardKey, String uidHex) throws Exception {
    javax.crypto.Mac mac = javax.crypto.Mac.getInstance("HmacSHA256");
    mac.init(new javax.crypto.spec.SecretKeySpec(cardKey.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
    return HexFormat.of().formatHex(mac.doFinal(("hbr-card-v1:" + uidHex).getBytes(StandardCharsets.UTF_8)));
  }

  private String event(String type, String severity, String occurredAt, String detailsJson) {
    return event(UUID.randomUUID(), type, severity, occurredAt, detailsJson);
  }

  private String event(UUID id, String type, String severity, String occurredAt, String detailsJson) {
    return "{\"id\":\"" + id + "\",\"eventType\":\"" + type + "\",\"severity\":\"" + severity + "\","
        + "\"occurredAt\":" + (occurredAt == null ? "null" : "\"" + occurredAt + "\"") + ","
        + "\"uptimeMs\":1234,\"details\":" + detailsJson + ",\"firmwareVersion\":\"0.2.0\"}";
  }

  // ---------- health + logins ----------

  @Test
  void healthIsPublic() throws Exception {
    json(get("/api/v1/health"), 200);
  }

  @Test
  void adminApiNeedsLoginAndDoesNotTriggerBrowserPopup() throws Exception {
    mvc.perform(get("/api/v1/racks"))
        .andExpect(status().isUnauthorized())
        .andExpect(header().doesNotExist("WWW-Authenticate"))
        .andExpect(jsonPath("$.status").value(401));
    mvc.perform(get("/api/v1/racks").with(httpBasic("admin", "wrong"))).andExpect(status().isUnauthorized());
  }

  @Test
  void viewerCanReadButNotChange() throws Exception {
    json(get("/api/v1/racks").with(VIEWER), 200);
    JsonNode me = json(get("/api/v1/me").with(VIEWER), 200);
    assertThat(me.get("canEdit").asBoolean()).isFalse();
    mvc.perform(jsonBody(post("/api/v1/racks"), "{\"name\":\"nope\"}").with(VIEWER))
        .andExpect(status().isForbidden());
  }

  @Test
  void validationErrorsAreClear() throws Exception {
    JsonNode err = json(jsonBody(post("/api/v1/racks"), "{\"name\":\"\"}").with(ADMIN), 400);
    assertThat(err.at("/errors/name").asText()).isNotBlank();
    json(jsonBody(post("/api/v1/credentials"), "{\"credentialReference\":\"xyz\",\"displayLabel\":\"a\"}")
        .with(ADMIN), 400);
  }

  // ---------- device authentication ----------

  @Test
  void deviceEndpointsRejectMissingWrongOrSwappedTokens() throws Exception {
    Device a = newRackWithDevice("Auth A");
    Device b = newRackWithDevice("Auth B");
    String path = "/api/v1/devices/" + a.deviceId() + "/authorization-snapshot";
    mvc.perform(get(path)).andExpect(status().isUnauthorized());
    mvc.perform(get(path).header("Authorization", "Bearer not-the-token")).andExpect(status().isUnauthorized());
    // B's (valid) token on A's URL: the URL's device ID is not proof of identity.
    mvc.perform(get(path).header("Authorization", "Bearer " + b.token())).andExpect(status().isUnauthorized());
    // Admin password doesn't work on device endpoints either.
    mvc.perform(get(path).with(ADMIN)).andExpect(status().isUnauthorized());
    json(asDevice(get(path), a), 200);
  }

  @Test
  void rotatedTokenReplacesOldOne() throws Exception {
    Device d = newRackWithDevice("Rotate");
    JsonNode rotated = json(post("/api/v1/racks/" + d.rackId() + "/devices/" + d.deviceId() + "/rotate-token")
        .with(ADMIN), 200);
    String path = "/api/v1/devices/" + d.deviceId() + "/authorization-snapshot";
    mvc.perform(asDevice(get(path), d)).andExpect(status().isUnauthorized());
    mvc.perform(get(path).header("Authorization", "Bearer " + rotated.get("deviceToken").asText()))
        .andExpect(status().isOk());
  }

  @Test
  void tokenIsStoredOnlyAsHash() throws Exception {
    Device d = newRackWithDevice("Hash");
    String stored = jdbc.sql("SELECT token_hash FROM devices WHERE id = :id")
        .param("id", UUID.fromString(d.deviceId())).query(String.class).single();
    assertThat(stored).isNotEqualTo(d.token()).hasSize(64);
    String expected = HexFormat.of().formatHex(
        MessageDigest.getInstance("SHA-256").digest(d.token().getBytes(StandardCharsets.UTF_8)));
    assertThat(stored).isEqualTo(expected);
  }

  // ---------- events ----------

  @Test
  void eventUploadIsIdempotent() throws Exception {
    Device d = newRackWithDevice("Idempotent");
    UUID id = UUID.randomUUID();
    String batch = "{\"events\":[" + event(id, "DEVICE_BOOT", "INFO", null, "{}") + "]}";
    String path = "/api/v1/devices/" + d.deviceId() + "/events";
    JsonNode first = json(asDevice(jsonBody(post(path), batch), d), 200);
    JsonNode second = json(asDevice(jsonBody(post(path), batch), d), 200);  // the "retry"
    assertThat(first.get("accepted").asInt()).isEqualTo(1);
    assertThat(second.get("accepted").asInt()).isZero();
    assertThat(second.get("duplicates").asInt()).isEqualTo(1);
    long rows = jdbc.sql("SELECT count(*) FROM security_events WHERE id = :id").param("id", id)
        .query(Long.class).single();
    assertThat(rows).isEqualTo(1);
  }

  @Test
  void missingOrCrazyDeviceTimeUsesServerTime() throws Exception {
    Device d = newRackWithDevice("Clock");
    UUID noClock = UUID.randomUUID();
    UUID future = UUID.randomUUID();
    UUID good = UUID.randomUUID();
    String batch = "{\"events\":["
        + event(noClock, "DEVICE_BOOT", "INFO", null, "{}") + ","
        + event(future, "DEVICE_BOOT", "INFO", "2099-01-01T00:00:00Z", "{}") + ","
        + event(good, "DEVICE_BOOT", "INFO", java.time.Instant.now().minusSeconds(30).toString(), "{}") + "]}";
    json(asDevice(jsonBody(post("/api/v1/devices/" + d.deviceId() + "/events"), batch), d), 200);
    assertThat(timeSource(noClock)).isEqualTo("SERVER");
    assertThat(timeSource(future)).isEqualTo("SERVER");
    assertThat(timeSource(good)).isEqualTo("DEVICE");
  }

  private String timeSource(UUID id) {
    return jdbc.sql("SELECT time_source FROM security_events WHERE id = :id").param("id", id)
        .query(String.class).single();
  }

  @Test
  void badEventsAreRejected() throws Exception {
    Device d = newRackWithDevice("Bad events");
    String path = "/api/v1/devices/" + d.deviceId() + "/events";
    json(asDevice(jsonBody(post(path), "{\"events\":[" + event("DEVICE_BOOT", "LOUD", null, "{}") + "]}"), d), 400);
    json(asDevice(jsonBody(post(path), "{\"events\":[" + event("lowercase", "INFO", null, "{}") + "]}"), d), 400);
    json(asDevice(jsonBody(post(path), "{\"events\":[" + event("DEVICE_BOOT", "INFO", null, "[1,2]") + "]}"), d), 400);
    json(asDevice(jsonBody(post(path), "{\"events\":[]}"), d), 400);
  }

  // ---------- the whole card flow ----------

  @Test
  void tapUnknownCardThenRegisterThenRevoke() throws Exception {
    Device d = newRackWithDevice("Card flow");
    String ref = credentialRef("test-card-key-1234567890", "04a1b2c3d4e5f6");
    String snapshotPath = "/api/v1/devices/" + d.deviceId() + "/authorization-snapshot";

    // 1. Empty list at first.
    JsonNode snap1 = json(asDevice(get(snapshotPath), d), 200);
    assertThat(snap1.get("credentialReferences")).isEmpty();
    long rev1 = snap1.get("revision").asLong();
    assertThat(snap1.get("validUntilEpoch").asLong() - snap1.get("issuedAtEpoch").asLong())
        .isEqualTo(72 * 3600);

    // 2. Rider taps: the rack denies and reports it.
    String denied = event("ACCESS_DENIED", "LOW", null,
        "{\"credentialReference\":\"" + ref + "\",\"reason\":\"NOT_LISTED\"}");
    json(asDevice(jsonBody(post("/api/v1/devices/" + d.deviceId() + "/events"),
        "{\"events\":[" + denied + "]}"), d), 200);

    // 3. Dashboard shows it as an unknown card.
    JsonNode unknown = json(get("/api/v1/credentials/unknown").with(VIEWER), 200);
    assertThat(unknown.findValuesAsText("credentialReference")).contains(ref);

    // 4. Admin registers it for this rack.
    JsonNode cred = json(jsonBody(post("/api/v1/credentials"),
        "{\"credentialReference\":\"" + ref + "\",\"displayLabel\":\"Test rider\",\"allRacks\":false,"
            + "\"rackIds\":[\"" + d.rackId() + "\"]}").with(ADMIN), 201);
    assertThat(cred.get("status").asText()).isEqualTo("ACTIVE");
    JsonNode unknownAfter = json(get("/api/v1/credentials/unknown").with(ADMIN), 200);
    assertThat(unknownAfter.findValuesAsText("credentialReference")).doesNotContain(ref);

    // Registering the same card twice is a conflict.
    json(jsonBody(post("/api/v1/credentials"),
        "{\"credentialReference\":\"" + ref + "\",\"displayLabel\":\"Again\"}").with(ADMIN), 409);

    // 5. Rack's next download includes it, with a higher revision.
    JsonNode snap2 = json(asDevice(get(snapshotPath), d), 200);
    assertThat(snap2.get("credentialReferences").toString()).contains(ref);
    assertThat(snap2.get("revision").asLong()).isGreaterThan(rev1);

    // A different rack does NOT get it (not allRacks).
    Device other = newRackWithDevice("Other rack");
    JsonNode otherSnap = json(asDevice(get("/api/v1/devices/" + other.deviceId() + "/authorization-snapshot"),
        other), 200);
    assertThat(otherSnap.get("credentialReferences").toString()).doesNotContain(ref);

    // 6. Revoke: gone from the list, revision up again, and it's in the audit log.
    String credId = cred.get("id").asText();
    JsonNode revoked = json(post("/api/v1/credentials/" + credId + "/revoke").with(ADMIN), 200);
    assertThat(revoked.get("status").asText()).isEqualTo("REVOKED");
    JsonNode snap3 = json(asDevice(get(snapshotPath), d), 200);
    assertThat(snap3.get("credentialReferences").toString()).doesNotContain(ref);
    assertThat(snap3.get("revision").asLong()).isGreaterThan(snap2.get("revision").asLong());
    // Can't sneak it back on.
    json(jsonBody(patch("/api/v1/credentials/" + credId), "{\"active\":true}").with(ADMIN), 400);

    JsonNode audit = json(get("/api/v1/audit-log?size=200").with(ADMIN), 200);
    assertThat(audit.findValuesAsText("action")).contains("CREDENTIAL_CREATED", "CREDENTIAL_REVOKED");
  }

  @Test
  void allRacksCardAppearsEverywhere() throws Exception {
    Device d1 = newRackWithDevice("All racks 1");
    Device d2 = newRackWithDevice("All racks 2");
    String ref = credentialRef("another-key-0123456789", "11223344");
    json(jsonBody(post("/api/v1/credentials"),
        "{\"credentialReference\":\"" + ref.toUpperCase() + "\",\"displayLabel\":\"Staff\",\"allRacks\":true}")
        .with(ADMIN), 201);
    for (Device d : new Device[] {d1, d2}) {
      JsonNode snap = json(asDevice(get("/api/v1/devices/" + d.deviceId() + "/authorization-snapshot"), d), 200);
      assertThat(snap.get("credentialReferences").toString()).contains(ref);  // stored lowercase
    }
  }

  // ---------- heartbeat, rack status, alerts, reports ----------

  @Test
  void heartbeatMakesRackOnlineAndTamperMakesItWarning() throws Exception {
    Device d = newRackWithDevice("Status");
    JsonNode before = json(get("/api/v1/racks/" + d.rackId()).with(ADMIN), 200);
    assertThat(before.at("/rack/status").asText()).isEqualTo("OFFLINE");  // has a device, never seen

    json(asDevice(jsonBody(post("/api/v1/devices/" + d.deviceId() + "/heartbeat"),
        "{\"firmwareVersion\":\"0.2.0\",\"readerOk\":true,\"accelOk\":true,\"snapshotRevision\":5}"), d), 200);
    JsonNode online = json(get("/api/v1/racks/" + d.rackId()).with(ADMIN), 200);
    assertThat(online.at("/rack/status").asText()).isEqualTo("ONLINE");
    assertThat(online.at("/devices/0/firmwareVersion").asText()).isEqualTo("0.2.0");

    UUID tamperId = UUID.randomUUID();
    json(asDevice(jsonBody(post("/api/v1/devices/" + d.deviceId() + "/events"),
        "{\"events\":[" + event(tamperId, "TAMPER_ALARM", "HIGH", null, "{\"deviationG\":1.2}") + "]}"), d), 200);
    JsonNode warning = json(get("/api/v1/racks/" + d.rackId()).with(ADMIN), 200);
    assertThat(warning.at("/rack/status").asText()).isEqualTo("WARNING");

    JsonNode tamperEvents = json(get("/api/v1/events?rackId=" + d.rackId() + "&type=TAMPER").with(VIEWER), 200);
    assertThat(tamperEvents.get("total").asLong()).isEqualTo(1);

    json(post("/api/v1/events/" + tamperId + "/acknowledge").with(ADMIN), 200);
    JsonNode cleared = json(get("/api/v1/racks/" + d.rackId()).with(ADMIN), 200);
    assertThat(cleared.at("/rack/status").asText()).isEqualTo("ONLINE");

    JsonNode report = json(get("/api/v1/reports/summary?days=7").with(VIEWER), 200);
    assertThat(report.at("/byType/TAMPER_ALARM").asLong()).isGreaterThanOrEqualTo(1);
  }

  @Test
  void deviceProvisioningReturnsConfigSnippetOnce() throws Exception {
    Device d = newRackWithDevice("Snippet");
    JsonNode detail = json(get("/api/v1/racks/" + d.rackId()).with(ADMIN), 200);
    // The token is never returned again by normal reads.
    assertThat(detail.toString()).doesNotContain(d.token());
  }

  @Test
  void rackCoordinatesComeAsAPairAndCanBeCleared() throws Exception {
    JsonNode rack = json(jsonBody(post("/api/v1/racks"),
        "{\"name\":\"Mapped\",\"latitude\":37.2297,\"longitude\":-80.4199}").with(ADMIN), 201);
    assertThat(rack.at("/rack/latitude").asDouble()).isEqualTo(37.2297);
    String id = rack.at("/rack/id").asText();
    // Only one of the two -> rejected.
    json(jsonBody(patch("/api/v1/racks/" + id), "{\"latitude\":37.0}").with(ADMIN), 400);
    // Out of range -> rejected.
    json(jsonBody(patch("/api/v1/racks/" + id), "{\"latitude\":95,\"longitude\":0}").with(ADMIN), 400);
    JsonNode cleared = json(jsonBody(patch("/api/v1/racks/" + id), "{\"clearCoordinates\":true}").with(ADMIN), 200);
    assertThat(cleared.at("/rack/latitude").isNull()).isTrue();
    assertThat(cleared.at("/rack/name").asText()).isEqualTo("Mapped");
  }
}
