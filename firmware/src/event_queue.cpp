#include "event_queue.h"

#include <LittleFS.h>
#include <esp_random.h>
#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>

#include "device_config.h"
#include "device_status.h"
#include "hbr_util.h"

namespace {
// One event per line ("JSON Lines"). Appending a line is quick and a crash
// can at worst lose the line being written, never the earlier ones.
constexpr char kQueuePath[] = "/events.jsonl";
constexpr char kTempPath[] = "/events.tmp";
// Size limits so a long outage can't fill the flash. Above the soft limit
// we only keep MEDIUM+ events (tamper, faults); above the hard limit, nothing.
constexpr size_t kSoftLimitBytes = 256 * 1024;
constexpr size_t kHardLimitBytes = 400 * 1024;

bool queueReady = false;
size_t queuedCount = 0;
SemaphoreHandle_t mutex = nullptr;

// Takes the mutex when created, gives it back when it goes out of scope
// (even on an early `return`). This pattern is called RAII.
class Guard {
 public:
  Guard() { if (mutex) xSemaphoreTake(mutex, portMAX_DELAY); }
  ~Guard() { if (mutex) xSemaphoreGive(mutex); }
};

size_t countLines() {
  File f = LittleFS.open(kQueuePath, FILE_READ);
  if (!f) return 0;
  size_t n = 0;
  while (f.available()) {
    if (f.read() == '\n') n++;
  }
  f.close();
  return n;
}

size_t queueBytes() {
  File f = LittleFS.open(kQueuePath, FILE_READ);
  if (!f) return 0;
  size_t s = f.size();
  f.close();
  return s;
}

std::string newEventId() {
  uint8_t bytes[16];
  esp_fill_random(bytes, sizeof(bytes));  // hardware random number generator
  return hbr::formatUuidV4(bytes);
}

bool isLowPriority(const char *severity) {
  return strcmp(severity, "INFO") == 0 || strcmp(severity, "LOW") == 0;
}
}  // namespace

bool eventQueueSetup() {
  if (!mutex) mutex = xSemaphoreCreateMutex();
  // true = format the partition if it can't be mounted (first boot).
  queueReady = LittleFS.begin(true);
  if (queueReady) {
    Guard g;
    queuedCount = countLines();
  }
  return queueReady;
}

bool eventQueuePush(const char *type, const char *severity) {
  JsonDocument none;
  none.to<JsonObject>();
  return eventQueuePush(type, severity, none);
}

bool eventQueuePush(const char *type, const char *severity, const JsonDocument &details) {
  if (!queueReady || !type || !severity) return false;
  JsonDocument event;
  event["id"] = newEventId();
  event["deviceId"] = HBR_DEVICE_ID;
  event["eventType"] = type;
  event["severity"] = severity;
  int64_t now = deviceNowEpoch();
  if (now > 0) event["occurredAt"] = hbr::formatIsoUtc(now);
  else event["occurredAt"] = nullptr;  // backend will use its receive time
  event["uptimeMs"] = millis();
  if (details.is<JsonObjectConst>()) event["details"] = details.as<JsonObjectConst>();
  else event["details"].to<JsonObject>();
  event["firmwareVersion"] = HBR_FIRMWARE_VERSION;

  Guard g;
  size_t bytes = queueBytes();
  if (bytes >= kHardLimitBytes || (bytes >= kSoftLimitBytes && isLowPriority(severity))) {
    Serial.printf("[queue] FULL (%u bytes), dropped %s\n", (unsigned)bytes, type);
    return false;
  }
  File file = LittleFS.open(kQueuePath, FILE_APPEND);
  if (!file) return false;
  bool ok = serializeJson(event, file) > 0 && file.print('\n') == 1;
  file.flush();
  file.close();
  if (ok) queuedCount++;
  return ok;
}

bool eventQueueReadBatch(JsonArray batch, std::vector<String> &ids, size_t limit) {
  if (!queueReady) return false;
  Guard g;
  File input = LittleFS.open(kQueuePath, FILE_READ);
  if (!input) return true;  // no file yet = nothing queued
  while (input.available() && ids.size() < limit) {
    String line = input.readStringUntil('\n');
    JsonDocument event;
    // Skip damaged lines (e.g. power cut mid-write) instead of getting stuck.
    if (deserializeJson(event, line) || !event["id"].is<const char *>()) continue;
    ids.emplace_back(event["id"].as<const char *>());
    batch.add(event);
  }
  input.close();
  return true;
}

bool eventQueueRemove(const std::vector<String> &ids) {
  if (!queueReady) return false;
  Guard g;
  File input = LittleFS.open(kQueuePath, FILE_READ);
  File output = LittleFS.open(kTempPath, FILE_WRITE);
  if (!input || !output) {
    if (input) input.close();
    if (output) output.close();
    return false;
  }
  size_t kept = 0;
  while (input.available()) {
    String line = input.readStringUntil('\n');
    JsonDocument event;
    if (deserializeJson(event, line)) continue;  // drop damaged lines
    String id = event["id"].as<String>();
    bool acknowledged = false;
    for (const String &sent : ids) {
      if (id == sent) { acknowledged = true; break; }
    }
    if (!acknowledged) {
      output.print(line);
      output.print('\n');
      kept++;
    }
  }
  output.flush();
  input.close();
  output.close();
  // Write-new-then-rename: LittleFS rename replaces the old file in one step,
  // so a power cut leaves either the old queue or the new one, never neither.
  bool ok = LittleFS.rename(kTempPath, kQueuePath);
  if (!ok) {
    LittleFS.remove(kQueuePath);
    ok = LittleFS.rename(kTempPath, kQueuePath);
  }
  if (ok) queuedCount = kept;
  return ok;
}

size_t eventQueueCount() {
  Guard g;
  return queuedCount;
}

bool eventQueueClear() {
  if (!queueReady) return false;
  Guard g;
  LittleFS.remove(kQueuePath);
  queuedCount = 0;
  return true;
}
