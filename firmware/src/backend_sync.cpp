#include "backend_sync.h"

#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <esp_sntp.h>
#include <time.h>

#include <atomic>
#include <vector>

#include "access_policy.h"
#include "device_config.h"
#include "device_status.h"
#include "event_queue.h"
#include "lock.h"

namespace {
constexpr size_t kBatchLimit = 20;
constexpr uint32_t kSnapshotEveryMs = 60000;
constexpr uint32_t kHeartbeatEveryMs = 60000;
constexpr uint32_t kIdleUploadEveryMs = 15000;  // retry leftovers even without a request
constexpr uint32_t kWifiRetryEveryMs = 10000;
constexpr uint32_t kMaxBackoffMs = 60000;
constexpr uint32_t kTaskTickMs = 200;

std::atomic<bool> uploadRequested{true};
std::atomic<bool> snapshotRequested{true};
uint32_t lastWifiAttemptMs = 0;
bool wifiStarted = false;
bool ntpStarted = false;
uint32_t lastSnapshotMs = 0;
uint32_t lastHeartbeatMs = 0;
uint32_t lastUploadMs = 0;
uint32_t uploadBackoffMs = 0;
uint8_t singleEventMode = 0;  // >0: send one event at a time (after a 400 on a batch)

bool startsWith(const char *s, const char *prefix) { return strncmp(s, prefix, strlen(prefix)) == 0; }
bool isHttps() { return startsWith(HBR_API_BASE_URL, "https://"); }
bool isHttp() { return startsWith(HBR_API_BASE_URL, "http://"); }

bool transportAllowed() {
  if (isHttps()) return strlen(HBR_API_ROOT_CA) > 0;  // must verify the server's certificate
  if (isHttp()) return HBR_ALLOW_INSECURE_HTTP != 0;  // explicit opt-in for the local demo
  return false;
}

String apiPath(const char *endpoint) {
  String base = HBR_API_BASE_URL;
  while (base.endsWith("/")) base.remove(base.length() - 1);
  return base + "/api/v1/devices/" + HBR_DEVICE_ID + "/" + endpoint;
}

struct HttpResult {
  int status = -1;  // negative = network error (no answer)
  String body;
};

// One HTTP request with short timeouts. Runs in the network task only.
HttpResult apiRequest(const char *method, const char *endpoint, const String &body) {
  HttpResult result;
  // Declared before `http` so they are destroyed after it.
  WiFiClientSecure secureClient;
  WiFiClient plainClient;
  HTTPClient http;
  String url = apiPath(endpoint);
  bool begun;
  if (isHttps()) {
    secureClient.setCACert(HBR_API_ROOT_CA);
    begun = http.begin(secureClient, url);
  } else {
    begun = http.begin(plainClient, url);
  }
  if (!begun) return result;
  http.setConnectTimeout(4000);
  http.setTimeout(5000);
  http.addHeader("Authorization", String("Bearer ") + HBR_DEVICE_TOKEN);
  if (strcmp(method, "GET") == 0) {
    result.status = http.GET();
  } else {
    http.addHeader("Content-Type", "application/json");
    result.status = http.POST(body);
  }
  if (result.status > 0) result.body = http.getString();
  http.end();
  if (result.status == 401 || result.status == 403) {
    Serial.printf("[net] backend rejected the device token (%d). Check HBR_DEVICE_ID/TOKEN.\n",
                  result.status);
  }
  return result;
}

void keepWifiConnected() {
  bool connected = WiFi.status() == WL_CONNECTED;
  if (connected != deviceStatus.wifiConnected.load()) {
    deviceStatus.wifiConnected = connected;
    if (connected) {
      Serial.printf("[net] Wi-Fi connected, IP %s, signal %d dBm\n",
                    WiFi.localIP().toString().c_str(), WiFi.RSSI());
      snapshotRequested = true;
      uploadRequested = true;
    } else {
      Serial.println("[net] Wi-Fi disconnected; rack keeps working offline");
    }
  }
  if (connected) {
    if (!ntpStarted) {
      // Ask internet time servers for the time (UTC). Runs in the background;
      // time() becomes correct a second or two later.
      configTime(0, 0, "pool.ntp.org", "time.google.com", "time.nist.gov");
      ntpStarted = true;
    }
    return;
  }
  // Calling WiFi.begin() every loop would restart the connection before it
  // ever finishes, so only retry every 10 seconds.
  if (wifiStarted && millis() - lastWifiAttemptMs < kWifiRetryEveryMs) return;
  wifiStarted = true;
  lastWifiAttemptMs = millis();
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);  // a bit more power, much more reliable/faster replies
  WiFi.disconnect();
  WiFi.begin(HBR_WIFI_SSID, HBR_WIFI_PASSWORD);
}

void fetchSnapshot() {
  HttpResult r = apiRequest("GET", "authorization-snapshot", "");
  if (r.status != 200) {
    if (r.status != 401 && r.status != 403) {
      Serial.printf("[net] card list download failed (%d)\n", r.status);
    }
    deviceStatus.lastSyncOk = false;
    return;
  }
  hbr::AuthSnapshot incoming;
  std::string error;
  if (!hbr::parseSnapshotJson(r.body.c_str(), r.body.length(), incoming, error)) {
    Serial.printf("[net] card list from server is invalid: %s\n", error.c_str());
    return;
  }
  hbr::SnapshotUpdate result = accessPolicyOfferSnapshot(incoming);
  if (result == hbr::SnapshotUpdate::RejectOlder) {
    Serial.println("[net] server sent an OLDER card list than we have; ignored (rollback protection)."
                   " If you wiped the database, run `forget-snapshot`.");
  }
  deviceStatus.lastSyncOk = true;
}

void sendHeartbeat() {
  JsonDocument doc;
  AccessPolicyInfo info = accessPolicyInfo();
  doc["firmwareVersion"] = HBR_FIRMWARE_VERSION;
  doc["uptimeMs"] = millis();
  doc["wifiRssi"] = WiFi.RSSI();
  doc["freeHeap"] = ESP.getFreeHeap();
  doc["queueDepth"] = eventQueueCount();
  doc["snapshotRevision"] = info.revision;
  doc["snapshotValidUntilEpoch"] = info.validUntilEpoch;
  doc["snapshotCardCount"] = info.cardCount;
  doc["clockSynced"] = deviceNowEpoch() > 0;
  doc["lockUnlocked"] = deviceStatus.lockUnlocked.load();
  doc["alarmActive"] = deviceStatus.alarmActive.load();
  doc["readerOk"] = deviceStatus.readerOk.load();
  doc["accelOk"] = deviceStatus.accelOk.load();
  doc["servoEnabled"] = lockServoEnabled();
  doc["lastDeviationG"] = deviceStatus.lastDeviationG.load();
  String body;
  serializeJson(doc, body);
  HttpResult r = apiRequest("POST", "heartbeat", body);
  deviceStatus.lastSyncOk = r.status >= 200 && r.status < 300;
}

// Returns true if the queue is now empty (or we should stop for now).
bool uploadOneBatch() {
  JsonDocument body;
  JsonArray batch = body["events"].to<JsonArray>();
  std::vector<String> ids;
  size_t limit = singleEventMode ? 1 : kBatchLimit;
  if (!eventQueueReadBatch(batch, ids, limit)) return true;
  if (ids.empty()) return true;  // nothing to send

  String payload;
  serializeJson(body, payload);
  HttpResult r = apiRequest("POST", "events", payload);
  if (r.status >= 200 && r.status < 300) {
    // Success acknowledges the whole batch. Any events the server had already
    // (from an earlier retry) are skipped by it, not duplicated.
    eventQueueRemove(ids);
    if (singleEventMode) singleEventMode--;
    uploadBackoffMs = 0;
    Serial.printf("[net] uploaded %u event(s)\n", (unsigned)ids.size());
    return false;  // maybe more to send
  }
  if (r.status == 400 || r.status == 422) {
    if (ids.size() > 1) {
      // Something in this batch is bad. Send one by one to find it, so one
      // broken event can't block all the good ones forever.
      singleEventMode = kBatchLimit;
    } else {
      Serial.printf("[net] server rejected event %s; dropping it: %s\n", ids[0].c_str(),
                    r.body.substring(0, 160).c_str());
      eventQueueRemove(ids);
    }
    return false;
  }
  // Network error or server error: keep events, wait longer each time (2,4,8..60 s).
  uploadBackoffMs = uploadBackoffMs ? min(uploadBackoffMs * 2, kMaxBackoffMs) : 2000;
  Serial.printf("[net] upload failed (%d); retry in %u s\n", r.status,
                (unsigned)(uploadBackoffMs / 1000));
  return true;
}

void syncTask(void *) {
  for (;;) {
    keepWifiConnected();
    if (WiFi.status() == WL_CONNECTED) {
      uint32_t now = millis();
      if (snapshotRequested.exchange(false) || now - lastSnapshotMs >= kSnapshotEveryMs) {
        lastSnapshotMs = now;
        fetchSnapshot();
      }
      if (now - lastHeartbeatMs >= kHeartbeatEveryMs || lastHeartbeatMs == 0) {
        lastHeartbeatMs = now ? now : 1;
        sendHeartbeat();
      }
      bool due = now - lastUploadMs >= (uploadBackoffMs ? uploadBackoffMs : kIdleUploadEveryMs);
      if ((uploadRequested.load() && uploadBackoffMs == 0) || due) {
        uploadRequested = false;
        lastUploadMs = now;
        // Send up to a few batches per tick, then let the loop breathe.
        for (int i = 0; i < 5; i++) {
          if (uploadOneBatch()) break;
        }
      }
    }
    vTaskDelay(pdMS_TO_TICKS(kTaskTickMs));
  }
}
}  // namespace

bool backendSyncConfigured() {
  return strlen(HBR_WIFI_SSID) && strlen(HBR_DEVICE_ID) && strlen(HBR_DEVICE_TOKEN) &&
         transportAllowed();
}

void backendSyncSetup() {
  if (!backendSyncConfigured()) {
    Serial.println("[net] not configured (see include/config.example.h); running OFFLINE only");
    if (isHttp() && !HBR_ALLOW_INSECURE_HTTP)
      Serial.println("[net] http:// URL needs HBR_ALLOW_INSECURE_HTTP 1 (local demo only)");
    if (isHttps() && !strlen(HBR_API_ROOT_CA))
      Serial.println("[net] https:// URL needs HBR_API_ROOT_CA");
    return;
  }
  if (isHttp()) Serial.println("[net] WARNING: plain HTTP (no encryption). Local demo only.");
  // 16 KB stack: TLS (https) needs a lot. Priority 1 = same as loop().
  // Core 0 is where the Wi-Fi driver runs; loop() runs on core 1.
  xTaskCreatePinnedToCore(syncTask, "hbr-sync", 16384, nullptr, 1, nullptr, 0);
}

void backendSyncRequestUpload() { uploadRequested = true; }
void backendSyncRequestSnapshot() { snapshotRequested = true; }
bool backendSyncWifiConnected() { return deviceStatus.wifiConnected.load(); }
