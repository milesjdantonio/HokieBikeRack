// PC unit tests for the access rules. Run: pio test -e native
// Each TEST_ function checks one rule. If you change a rule, add a test here.
#include <unity.h>

#include <string>

#include "access_rules.h"

using namespace hbr;

static const std::string kRefA(64, 'a');
static const std::string kRefB(64, 'b');
static const int64_t kIssued = 1793000000;            // some time in 2026
static const int64_t kValidUntil = kIssued + 72 * 3600;  // 72 h later

static AuthSnapshot makeSnapshot(uint64_t revision = 5) {
  AuthSnapshot s;
  s.loaded = true;
  s.revision = revision;
  s.issuedAtEpoch = kIssued;
  s.validUntilEpoch = kValidUntil;
  s.credentialRefs = {kRefA};
  return s;
}

void setUp() {}
void tearDown() {}

void test_listed_card_is_allowed_while_fresh() {
  AccessResult r = decideAccess(makeSnapshot(), kRefA, kIssued + 60);
  TEST_ASSERT_TRUE(r.allowed);
}

void test_unlisted_card_is_denied() {
  AccessResult r = decideAccess(makeSnapshot(), kRefB, kIssued + 60);
  TEST_ASSERT_FALSE(r.allowed);
  TEST_ASSERT_EQUAL_STRING("NOT_LISTED", denyReasonName(r.reason));
}

void test_no_snapshot_denies_everyone() {
  AuthSnapshot empty;
  AccessResult r = decideAccess(empty, kRefA, kIssued + 60);
  TEST_ASSERT_FALSE(r.allowed);
  TEST_ASSERT_EQUAL(static_cast<int>(DenyReason::NoSnapshot), static_cast<int>(r.reason));
}

void test_unknown_clock_denies_everyone() {
  AccessResult r = decideAccess(makeSnapshot(), kRefA, 0);
  TEST_ASSERT_FALSE(r.allowed);
  TEST_ASSERT_EQUAL(static_cast<int>(DenyReason::ClockNotSet), static_cast<int>(r.reason));
}

void test_clock_far_behind_server_is_not_trusted() {
  AccessResult r = decideAccess(makeSnapshot(), kRefA, kIssued - 2 * 3600);
  TEST_ASSERT_EQUAL(static_cast<int>(DenyReason::ClockNotSet), static_cast<int>(r.reason));
}

void test_expired_snapshot_denies_even_listed_card() {
  AccessResult r = decideAccess(makeSnapshot(), kRefA, kValidUntil);  // exactly at expiry
  TEST_ASSERT_FALSE(r.allowed);
  TEST_ASSERT_EQUAL(static_cast<int>(DenyReason::SnapshotExpired), static_cast<int>(r.reason));
}

void test_older_revision_is_rejected() {
  AuthSnapshot current = makeSnapshot(10);
  AuthSnapshot older = makeSnapshot(9);
  older.issuedAtEpoch = kIssued + 100;
  older.validUntilEpoch = kValidUntil + 100;
  TEST_ASSERT_EQUAL(static_cast<int>(SnapshotUpdate::RejectOlder),
                    static_cast<int>(evaluateSnapshotUpdate(current, older)));
}

void test_same_revision_reissued_later_refreshes_expiry() {
  AuthSnapshot current = makeSnapshot(10);
  AuthSnapshot again = makeSnapshot(10);
  again.issuedAtEpoch = kIssued + 600;
  again.validUntilEpoch = kValidUntil + 600;
  TEST_ASSERT_EQUAL(static_cast<int>(SnapshotUpdate::Accept),
                    static_cast<int>(evaluateSnapshotUpdate(current, again)));
  TEST_ASSERT_EQUAL(static_cast<int>(SnapshotUpdate::Unchanged),
                    static_cast<int>(evaluateSnapshotUpdate(current, current)));
}

void test_invalid_snapshot_is_rejected() {
  AuthSnapshot bad = makeSnapshot(11);
  bad.validUntilEpoch = bad.issuedAtEpoch;  // zero lifetime
  TEST_ASSERT_EQUAL(static_cast<int>(SnapshotUpdate::RejectInvalid),
                    static_cast<int>(evaluateSnapshotUpdate(makeSnapshot(1), bad)));
}

void test_parse_valid_json_and_sorts_refs() {
  std::string json = std::string("{\"revision\":7,\"issuedAtEpoch\":1793000000,") +
                     "\"validUntilEpoch\":1793259200,\"rackId\":\"r1\"," +
                     "\"credentialReferences\":[\"" + kRefB + "\",\"" + kRefA + "\"]}";
  AuthSnapshot s;
  std::string error;
  TEST_ASSERT_TRUE_MESSAGE(parseSnapshotJson(json.c_str(), json.size(), s, error), error.c_str());
  TEST_ASSERT_TRUE(s.loaded);
  TEST_ASSERT_EQUAL_UINT64(7, s.revision);
  TEST_ASSERT_EQUAL_STRING("r1", s.rackId.c_str());
  TEST_ASSERT_EQUAL(2, s.credentialRefs.size());
  TEST_ASSERT_EQUAL_STRING(kRefA.c_str(), s.credentialRefs[0].c_str());  // sorted
  TEST_ASSERT_TRUE(decideAccess(s, kRefB, 1793000100).allowed);
}

void test_parse_rejects_bad_ref_and_missing_fields() {
  AuthSnapshot s;
  std::string error;
  std::string badRef =
      "{\"revision\":1,\"issuedAtEpoch\":1,\"validUntilEpoch\":2,\"credentialReferences\":[\"XYZ\"]}";
  TEST_ASSERT_FALSE(parseSnapshotJson(badRef.c_str(), badRef.size(), s, error));
  std::string missing = "{\"revision\":1}";
  TEST_ASSERT_FALSE(parseSnapshotJson(missing.c_str(), missing.size(), s, error));
  std::string notJson = "hello";
  TEST_ASSERT_FALSE(parseSnapshotJson(notJson.c_str(), notJson.size(), s, error));
  TEST_ASSERT_FALSE(s.loaded);  // untouched on failure
}

void test_round_trip_to_flash_json() {
  AuthSnapshot original = makeSnapshot(42);
  original.credentialRefs = {kRefA, kRefB};
  std::string json = snapshotToJson(original);
  AuthSnapshot loaded;
  std::string error;
  TEST_ASSERT_TRUE(parseSnapshotJson(json.c_str(), json.size(), loaded, error));
  TEST_ASSERT_EQUAL_UINT64(42, loaded.revision);
  TEST_ASSERT_EQUAL(2, loaded.credentialRefs.size());
  TEST_ASSERT_EQUAL_INT64(kValidUntil, loaded.validUntilEpoch);
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_listed_card_is_allowed_while_fresh);
  RUN_TEST(test_unlisted_card_is_denied);
  RUN_TEST(test_no_snapshot_denies_everyone);
  RUN_TEST(test_unknown_clock_denies_everyone);
  RUN_TEST(test_clock_far_behind_server_is_not_trusted);
  RUN_TEST(test_expired_snapshot_denies_even_listed_card);
  RUN_TEST(test_older_revision_is_rejected);
  RUN_TEST(test_same_revision_reissued_later_refreshes_expiry);
  RUN_TEST(test_invalid_snapshot_is_rejected);
  RUN_TEST(test_parse_valid_json_and_sorts_refs);
  RUN_TEST(test_parse_rejects_bad_ref_and_missing_fields);
  RUN_TEST(test_round_trip_to_flash_json);
  return UNITY_END();
}
