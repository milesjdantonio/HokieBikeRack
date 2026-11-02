#include "network.h"

#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <vector>

#include "device_config.h"
#include "event_queue.h"

namespace {
constexpr size_t kBatchLimit = 10;
uint32_t lastSyncAttempt = 0;

bool configured() {
  return strlen(HBR_DEVICE_ID) && strlen(HBR_DEVICE_TOKEN) && strlen(HBR_API_ROOT_CA) &&
         strncmp(HBR_API_BASE_URL, "https://", 8) == 0;
}

void connectNetwork() {
  if (configured() && WiFi.status() != WL_CONNECTED) {
    WiFi.mode(WIFI_STA);
    WiFi.begin(HBR_WIFI_SSID, HBR_WIFI_PASSWORD);
  }
}

bool syncEvents() {
  if (!configured() || WiFi.status() != WL_CONNECTED) return false;

  JsonDocument body;
  JsonArray batch = body["events"].to<JsonArray>();
  std::vector<String> sentIds;
  if (!eventQueueReadBatch(batch, sentIds, kBatchLimit)) return false;
  if (sentIds.empty()) return true;  // nothing to send

  WiFiClientSecure tls;
  tls.setCACert(HBR_API_ROOT_CA);
  HTTPClient http;
  String url = String(HBR_API_BASE_URL) + "/api/v1/devices/" + HBR_DEVICE_ID + "/events";
  if (!http.begin(tls, url)) return false;
  http.setTimeout(8000);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", String("Bearer ") + HBR_DEVICE_TOKEN);
  String payload;
  serializeJson(body, payload);
  int status = http.POST(payload);
  http.end();
  // A successful response acknowledges the whole submitted batch. On any
  // failure, leave it on disk; a retry sends identical IDs and is idempotent.
  if (status < 200 || status >= 300) return false;

  return eventQueueRemove(sentIds);
}
}  // namespace

void networkSetup() {
  connectNetwork();
}

void networkUpdate() {
  connectNetwork();
  if (millis() - lastSyncAttempt >= 15000) {
    lastSyncAttempt = millis();
    syncEvents();
  }
}

bool networkIsConnected() {
  return WiFi.status() == WL_CONNECTED;
}
