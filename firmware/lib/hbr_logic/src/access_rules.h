#pragma once
// Access rules: should this card be let in? Owner: Person A
//
// No hardware here. Everything is plain C++ so it runs in the PC unit tests
// (firmware/test/test_access_rules).
//
// Big idea: the backend sends the rack a "snapshot" — a list of allowed card
// references plus an expiry time. The rack decides locally using that list,
// so it keeps working when Wi-Fi is down... but only until the snapshot
// expires (72 h). After that it denies everyone. This is called "fail-secure":
// when unsure, stay locked. See docs/notes/firmware.md.
#include <stddef.h>
#include <stdint.h>

#include <string>
#include <vector>

namespace hbr {

// The allowed-card list downloaded from the backend.
struct AuthSnapshot {
  bool loaded = false;           // false until we have a real snapshot
  uint64_t revision = 0;         // goes up every time an admin changes access
  int64_t issuedAtEpoch = 0;     // when the server made it (seconds since 1970, UTC)
  int64_t validUntilEpoch = 0;   // after this moment, deny everyone
  std::string rackId;
  // Credential references (HMAC of the card ID, never the raw ID). Kept sorted
  // so lookups are fast (binary search).
  std::vector<std::string> credentialRefs;
};

// Why a card was denied. Sent to the backend in the ACCESS_DENIED event.
enum class DenyReason {
  None,             // not denied
  NoSnapshot,       // we never got a list from the server
  ClockNotSet,      // we don't know the time, so we can't check expiry
  SnapshotExpired,  // list is older than allowed (offline too long)
  NotListed,        // card isn't on the list (unknown or revoked)
};

struct AccessResult {
  bool allowed;
  DenyReason reason;
};

// Short text name, e.g. "NOT_LISTED". Used in event details.
const char *denyReasonName(DenyReason reason);

// The decision. `nowEpoch` is the current UTC time in seconds, or 0 if the
// clock was never set (no NTP since power-on).
AccessResult decideAccess(const AuthSnapshot &snapshot, const std::string &credentialRef,
                          int64_t nowEpoch);

// What to do with a newly downloaded snapshot.
enum class SnapshotUpdate {
  Accept,         // newer (or same list re-issued with a later time) -> use it
  Unchanged,      // same thing we already have
  RejectOlder,    // older revision -> ignore (stops "rollback" to an old list
                  // that still contains a revoked card)
  RejectInvalid,  // broken data -> ignore
};
SnapshotUpdate evaluateSnapshotUpdate(const AuthSnapshot &current, const AuthSnapshot &incoming);

// Max cards in one snapshot. Keeps RAM use bounded (each ref is 64 chars).
constexpr size_t kMaxSnapshotRefs = 500;

// Reads the backend's JSON (see docs/API.md) into `out`. Returns false and
// sets `error` if anything is missing or malformed. Sorts the refs.
bool parseSnapshotJson(const char *json, size_t length, AuthSnapshot &out, std::string &error);

// Turns a snapshot back into JSON, for saving to flash so it survives reboot.
std::string snapshotToJson(const AuthSnapshot &snapshot);

}  // namespace hbr
