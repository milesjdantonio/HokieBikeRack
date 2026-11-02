/* Initial scaffold only; no hardware or lock actions are enabled.
 * Confirm exact ESP32, PN532 breakout/card technology, accelerometer module,
 * servo supply, and mechanical linkage before implementing hardware drivers.
 */
#include <Arduino.h>
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <LittleFS.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <time.h>
#include <vector>

#if __has_include("config.h")
#include "config.h"
#endif

#ifndef HBR_API_BASE_URL
#define HBR_API_BASE_URL ""
#endif
#ifndef HBR_DEVICE_ID
#define HBR_DEVICE_ID ""
#endif
#ifndef HBR_DEVICE_TOKEN
#define HBR_DEVICE_TOKEN ""
#endif
#ifndef HBR_API_ROOT_CA
#define HBR_API_ROOT_CA ""
#endif
#ifndef HBR_WIFI_SSID
#define HBR_WIFI_SSID ""
#endif
#ifndef HBR_WIFI_PASSWORD
#define HBR_WIFI_PASSWORD ""
#endif

namespace {
constexpr char kQueuePath[] = "/events.jsonl";
constexpr char kTempPath[] = "/events.tmp";
constexpr size_t kBatchLimit = 10;
bool queueReady = false;
uint32_t lastSyncAttempt = 0;

bool configured() {
#if defined(HBR_API_BASE_URL) && defined(HBR_DEVICE_ID) && defined(HBR_DEVICE_TOKEN) && defined(HBR_API_ROOT_CA)
  return strlen(HBR_DEVICE_ID) && strlen(HBR_DEVICE_TOKEN) && strlen(HBR_API_ROOT_CA) &&
         strncmp(HBR_API_BASE_URL, "https://", 8) == 0;
#else
  return false;
#endif
}

// Append-only JSONL makes every queued event survive reset/power loss. IDs are
// created once and retained unchanged for server-side idempotency on retries.
bool enqueueEvent(const char *type, const char *severity, const char *occurredAt,
                 const char *detailsJson = "{}") {
  if (!queueReady || !type || !severity || !occurredAt) return false;
  JsonDocument details;
  if (deserializeJson(details, detailsJson) || !details.is<JsonObject>()) return false;
  JsonDocument event;
  event["id"] = String((uint32_t)esp_random(), HEX) + "-" + String((uint32_t)esp_random(), HEX);
  event["deviceId"] = HBR_DEVICE_ID;
  event["eventType"] = type;
  event["severity"] = severity;
  event["occurredAt"] = occurredAt;
  event["details"] = details;
  event["firmwareVersion"] = "0.1.0";
  File file = LittleFS.open(kQueuePath, FILE_APPEND);
  if (!file) return false;
  bool ok = serializeJson(event, file) > 0 && file.println() > 0;
  file.flush();
  file.close();
  return ok;
}

bool syncEvents() {
  if (!queueReady || !configured() || WiFi.status() != WL_CONNECTED) return false;
  File input = LittleFS.open(kQueuePath, FILE_READ);
  if (!input || input.size() == 0) { if (input) input.close(); return true; }

  JsonDocument body;
  JsonArray batch = body["events"].to<JsonArray>();
  std::vector<String> sentIds;
  while (input.available() && sentIds.size() < kBatchLimit) {
    String line = input.readStringUntil('\n');
    JsonDocument event;
    if (deserializeJson(event, line) || !event["id"].is<const char *>()) continue;
    sentIds.emplace_back(event["id"].as<const char *>());
    batch.add(event);
  }
  input.close();
  if (sentIds.empty()) return false;

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

  input = LittleFS.open(kQueuePath, FILE_READ);
  File output = LittleFS.open(kTempPath, FILE_WRITE);
  if (!input || !output) { if (input) input.close(); if (output) output.close(); return false; }
  while (input.available()) {
    String line = input.readStringUntil('\n');
    JsonDocument event;
    if (deserializeJson(event, line)) continue;
    String id = event["id"].as<String>();
    bool acknowledged = false;
    for (const String &sent : sentIds) if (id == sent) { acknowledged = true; break; }
    if (!acknowledged) { output.print(line); output.println(); }
  }
  output.flush();
  input.close();
  output.close();
  LittleFS.remove(kQueuePath);
  return LittleFS.rename(kTempPath, kQueuePath);
}

void connectNetwork() {
#if defined(HBR_WIFI_SSID) && defined(HBR_WIFI_PASSWORD)
  if (configured() && WiFi.status() != WL_CONNECTED) {
    WiFi.mode(WIFI_STA);
    WiFi.begin(HBR_WIFI_SSID, HBR_WIFI_PASSWORD);
  }
#endif
}
} // namespace

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println("HokieBikeRack firmware scaffold; hardware is not initialized.");
  Serial.println("Planned: PN532 read-only bring-up, accelerometer sampling, offline policy.");
  Serial.println("MG90S output remains disabled pending power/mechanical safety review.");
  queueReady = LittleFS.begin(true);
  if (!queueReady) Serial.println("Event queue storage unavailable; event enqueue is disabled.");
  connectNetwork();
}

void loop() {
  // TODO: initialize PN532 only after the bus, pins, card technology, and library are confirmed.
  // TODO: sample/calibrate the 3-axis accelerometer and queue candidate tamper events.
  // TODO: check local authorization before any future bounded servo command.
  // TODO: never depend on network availability for the local authorization decision.
  connectNetwork();
  if (millis() - lastSyncAttempt >= 15000) {
    lastSyncAttempt = millis();
    syncEvents();
  }
  delay(1000);
}
