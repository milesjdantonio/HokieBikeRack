#include "event_queue.h"

#include <LittleFS.h>

#include "device_config.h"

namespace {
constexpr char kQueuePath[] = "/events.jsonl";
constexpr char kTempPath[] = "/events.tmp";
bool queueReady = false;
}  // namespace

bool eventQueueSetup() {
  queueReady = LittleFS.begin(true);
  return queueReady;
}

// Append-only JSONL makes every queued event survive reset/power loss. IDs are
// created once and retained unchanged for server-side idempotency on retries.
bool eventQueuePush(const char *type, const char *severity, const char *occurredAt,
                    const char *detailsJson) {
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

bool eventQueueReadBatch(JsonArray batch, std::vector<String> &ids, size_t limit) {
  if (!queueReady) return false;
  File input = LittleFS.open(kQueuePath, FILE_READ);
  if (!input || input.size() == 0) { if (input) input.close(); return true; }
  while (input.available() && ids.size() < limit) {
    String line = input.readStringUntil('\n');
    JsonDocument event;
    if (deserializeJson(event, line) || !event["id"].is<const char *>()) continue;
    ids.emplace_back(event["id"].as<const char *>());
    batch.add(event);
  }
  input.close();
  return true;
}

bool eventQueueRemove(const std::vector<String> &ids) {
  if (!queueReady) return false;
  File input = LittleFS.open(kQueuePath, FILE_READ);
  File output = LittleFS.open(kTempPath, FILE_WRITE);
  if (!input || !output) { if (input) input.close(); if (output) output.close(); return false; }
  while (input.available()) {
    String line = input.readStringUntil('\n');
    JsonDocument event;
    if (deserializeJson(event, line)) continue;
    String id = event["id"].as<String>();
    bool acknowledged = false;
    for (const String &sent : ids) if (id == sent) { acknowledged = true; break; }
    if (!acknowledged) { output.print(line); output.println(); }
  }
  output.flush();
  input.close();
  output.close();
  LittleFS.remove(kQueuePath);
  return LittleFS.rename(kTempPath, kQueuePath);
}
