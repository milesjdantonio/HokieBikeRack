#include "access_policy.h"

#include <Arduino.h>
#include <LittleFS.h>
#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>

#include "device_status.h"

namespace {
constexpr char kSnapshotPath[] = "/snapshot.json";
constexpr char kSnapshotTempPath[] = "/snapshot.tmp";
// The server re-issues the list every minute with a new expiry. Writing flash
// every minute would wear it out, so only save when the list changes or the
// expiry moved by at least an hour.
constexpr int64_t kResaveExpiryStepSec = 3600;

hbr::AuthSnapshot current;
uint64_t savedRevision = 0;
int64_t savedValidUntil = 0;
SemaphoreHandle_t mutex = nullptr;

class Guard {
 public:
  Guard() { if (mutex) xSemaphoreTake(mutex, portMAX_DELAY); }
  ~Guard() { if (mutex) xSemaphoreGive(mutex); }
};

void saveToFlash(const hbr::AuthSnapshot &snap) {
  std::string json = hbr::snapshotToJson(snap);
  File f = LittleFS.open(kSnapshotTempPath, FILE_WRITE);
  if (!f) return;
  bool ok = f.write(reinterpret_cast<const uint8_t *>(json.data()), json.size()) == json.size();
  f.close();
  if (ok && LittleFS.rename(kSnapshotTempPath, kSnapshotPath)) {
    savedRevision = snap.revision;
    savedValidUntil = snap.validUntilEpoch;
  }
}
}  // namespace

void accessPolicySetup() {
  if (!mutex) mutex = xSemaphoreCreateMutex();
  File f = LittleFS.open(kSnapshotPath, FILE_READ);
  if (!f) {
    Serial.println("[access] no saved card list yet; all cards denied until the backend sends one");
    return;
  }
  String json = f.readString();
  f.close();
  hbr::AuthSnapshot loaded;
  std::string error;
  if (!hbr::parseSnapshotJson(json.c_str(), json.length(), loaded, error)) {
    Serial.printf("[access] saved card list is damaged (%s); ignoring it\n", error.c_str());
    return;
  }
  Guard g;
  current = loaded;
  savedRevision = loaded.revision;
  savedValidUntil = loaded.validUntilEpoch;
  Serial.printf("[access] loaded saved card list: revision %llu, %u cards\n",
                (unsigned long long)loaded.revision, (unsigned)loaded.credentialRefs.size());
}

hbr::AccessResult accessPolicyCheck(const std::string &credentialRef) {
  Guard g;
  return hbr::decideAccess(current, credentialRef, deviceNowEpoch());
}

hbr::SnapshotUpdate accessPolicyOfferSnapshot(const hbr::AuthSnapshot &incoming) {
  Guard g;
  hbr::SnapshotUpdate result = hbr::evaluateSnapshotUpdate(current, incoming);
  if (result != hbr::SnapshotUpdate::Accept) return result;
  bool listChanged = incoming.revision != current.revision || !current.loaded;
  current = incoming;
  if (listChanged || incoming.validUntilEpoch - savedValidUntil >= kResaveExpiryStepSec ||
      incoming.revision != savedRevision) {
    saveToFlash(current);
  }
  if (listChanged) {
    Serial.printf("[access] new card list: revision %llu, %u cards\n",
                  (unsigned long long)current.revision, (unsigned)current.credentialRefs.size());
  }
  return result;
}

bool accessPolicyReady() {
  Guard g;
  int64_t now = deviceNowEpoch();
  return current.loaded && now > 0 && now < current.validUntilEpoch;
}

AccessPolicyInfo accessPolicyInfo() {
  Guard g;
  return {current.loaded, current.revision, current.validUntilEpoch, current.credentialRefs.size()};
}

void accessPolicyForget() {
  Guard g;
  current = hbr::AuthSnapshot();
  savedRevision = 0;
  savedValidUntil = 0;
  LittleFS.remove(kSnapshotPath);
}
