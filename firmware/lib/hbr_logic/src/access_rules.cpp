#include "access_rules.h"

#include <ArduinoJson.h>

#include <algorithm>

namespace hbr {

namespace {
// If our clock says it's more than 1 hour BEFORE the server made the list,
// our clock is wrong. Treat it like "clock not set" instead of trusting it.
constexpr int64_t kClockSkewAllowanceSec = 3600;

// A credential reference is 64 lowercase hex characters (SHA-256 output).
bool looksLikeRef(const char *s) {
  if (!s) return false;
  size_t n = 0;
  for (; s[n]; n++) {
    char c = s[n];
    bool hex = (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f');
    if (!hex) return false;
  }
  return n == 64;
}
}  // namespace

const char *denyReasonName(DenyReason reason) {
  switch (reason) {
    case DenyReason::None: return "NONE";
    case DenyReason::NoSnapshot: return "NO_SNAPSHOT";
    case DenyReason::ClockNotSet: return "CLOCK_NOT_SET";
    case DenyReason::SnapshotExpired: return "SNAPSHOT_EXPIRED";
    case DenyReason::NotListed: return "NOT_LISTED";
  }
  return "UNKNOWN";
}

AccessResult decideAccess(const AuthSnapshot &snapshot, const std::string &credentialRef,
                          int64_t nowEpoch) {
  // Order matters: check the "can we trust the list at all?" things first.
  if (!snapshot.loaded) return {false, DenyReason::NoSnapshot};
  if (nowEpoch <= 0 || nowEpoch < snapshot.issuedAtEpoch - kClockSkewAllowanceSec) {
    return {false, DenyReason::ClockNotSet};
  }
  if (nowEpoch >= snapshot.validUntilEpoch) return {false, DenyReason::SnapshotExpired};
  bool listed = std::binary_search(snapshot.credentialRefs.begin(),
                                   snapshot.credentialRefs.end(), credentialRef);
  if (!listed) return {false, DenyReason::NotListed};
  return {true, DenyReason::None};
}

SnapshotUpdate evaluateSnapshotUpdate(const AuthSnapshot &current, const AuthSnapshot &incoming) {
  if (!incoming.loaded || incoming.validUntilEpoch <= incoming.issuedAtEpoch ||
      incoming.credentialRefs.size() > kMaxSnapshotRefs) {
    return SnapshotUpdate::RejectInvalid;
  }
  if (!current.loaded) return SnapshotUpdate::Accept;
  if (incoming.revision < current.revision) return SnapshotUpdate::RejectOlder;
  if (incoming.revision > current.revision) return SnapshotUpdate::Accept;
  // Same revision: the server re-issues the same list every time we ask, with
  // a fresh expiry. Accept it so the 72 h timer restarts while we're online.
  if (incoming.issuedAtEpoch > current.issuedAtEpoch) return SnapshotUpdate::Accept;
  return SnapshotUpdate::Unchanged;
}

bool parseSnapshotJson(const char *json, size_t length, AuthSnapshot &out, std::string &error) {
  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, json, length);
  if (err) {
    error = std::string("bad JSON: ") + err.c_str();
    return false;
  }
  if (!doc["revision"].is<uint64_t>() || !doc["issuedAtEpoch"].is<int64_t>() ||
      !doc["validUntilEpoch"].is<int64_t>() || !doc["credentialReferences"].is<JsonArrayConst>()) {
    error = "missing revision/issuedAtEpoch/validUntilEpoch/credentialReferences";
    return false;
  }
  AuthSnapshot result;
  result.revision = doc["revision"].as<uint64_t>();
  result.issuedAtEpoch = doc["issuedAtEpoch"].as<int64_t>();
  result.validUntilEpoch = doc["validUntilEpoch"].as<int64_t>();
  result.rackId = doc["rackId"] | "";
  JsonArrayConst refs = doc["credentialReferences"].as<JsonArrayConst>();
  if (refs.size() > kMaxSnapshotRefs) {
    error = "too many credential references";
    return false;
  }
  for (JsonVariantConst ref : refs) {
    const char *s = ref.as<const char *>();
    if (!looksLikeRef(s)) {
      error = "credential reference is not 64 lowercase hex chars";
      return false;
    }
    result.credentialRefs.emplace_back(s);
  }
  std::sort(result.credentialRefs.begin(), result.credentialRefs.end());
  result.loaded = true;
  out = std::move(result);
  return true;
}

std::string snapshotToJson(const AuthSnapshot &snapshot) {
  JsonDocument doc;
  doc["revision"] = snapshot.revision;
  doc["issuedAtEpoch"] = snapshot.issuedAtEpoch;
  doc["validUntilEpoch"] = snapshot.validUntilEpoch;
  doc["rackId"] = snapshot.rackId;
  JsonArray refs = doc["credentialReferences"].to<JsonArray>();
  for (const std::string &ref : snapshot.credentialRefs) refs.add(ref);
  std::string out;
  serializeJson(doc, out);
  return out;
}

}  // namespace hbr
