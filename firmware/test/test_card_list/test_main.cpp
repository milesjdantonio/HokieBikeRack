// PC unit tests for the EEPROM card list, SHA-256/HMAC, and card references.
// Run: pio test -e native
#include <string.h>
#include <unity.h>

#include "card_list.h"
#include "hbr_util.h"
#include "hmac_sha256.h"

using namespace hbr;

void setUp() {}
void tearDown() {}

// A pretend EEPROM: 1 KB like the Uno, filled with 0xFF like a blank chip.
class FakeEeprom : public ByteStore {
 public:
  FakeEeprom() { memset(bytes, 0xFF, sizeof(bytes)); }
  uint16_t size() const override { return sizeof(bytes); }
  uint8_t read(uint16_t a) const override { return bytes[a]; }
  void write(uint16_t a, uint8_t v) override {
    bytes[a] = v;
    writes++;
  }
  uint8_t bytes[1024];
  int writes = 0;
};

static void refFor(uint8_t n, uint8_t out[kCardRefLength]) {
  for (uint8_t i = 0; i < kCardRefLength; i++) out[i] = static_cast<uint8_t>(n * 7 + i);
}

static void assertHex(const char *expected, const uint8_t *data, size_t length) {
  char hex[2 * 32 + 1];
  toHex(data, length, hex);
  TEST_ASSERT_EQUAL_STRING(expected, hex);
}

// ---- SHA-256 / HMAC (official test vectors) ----

void test_sha256_abc() {
  Sha256 sha;
  uint8_t digest[32];
  sha.update(reinterpret_cast<const uint8_t *>("abc"), 3);
  sha.finish(digest);
  assertHex("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", digest, 32);
}

void test_sha256_two_blocks() {
  // FIPS 180-2 example: 56 bytes, so the padding spills into a second block.
  const char *msg = "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq";
  Sha256 sha;
  uint8_t digest[32];
  sha.update(reinterpret_cast<const uint8_t *>(msg), strlen(msg));
  sha.finish(digest);
  assertHex("248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1", digest, 32);
}

void test_hmac_rfc4231_case_1() {
  uint8_t key[20];
  memset(key, 0x0b, sizeof(key));
  uint8_t mac[32];
  hmacSha256(key, sizeof(key), reinterpret_cast<const uint8_t *>("Hi There"), 8, mac);
  assertHex("b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7", mac, 32);
}

void test_hmac_rfc4231_case_2() {
  const char *msg = "what do ya want for nothing?";
  uint8_t mac[32];
  hmacSha256(reinterpret_cast<const uint8_t *>("Jefe"), 4,
             reinterpret_cast<const uint8_t *>(msg), strlen(msg), mac);
  assertHex("5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843", mac, 32);
}

void test_hmac_rfc4231_case_6_long_key() {
  uint8_t key[131];
  memset(key, 0xaa, sizeof(key));
  const char *msg = "Test Using Larger Than Block-Size Key - Hash Key First";
  uint8_t mac[32];
  hmacSha256(key, sizeof(key), reinterpret_cast<const uint8_t *>(msg), strlen(msg), mac);
  assertHex("60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54", mac, 32);
}

// ---- Card references ----

void test_card_ref_matches_backend_scheme() {
  // Same answer as tools/device_simulator.py (Python's hmac module) gives for
  // key "demo-card-key-0123456789" and card 04a1b2c3d4: the first 32 hex
  // characters of cb9df64f51649bd4d49e89943ffef155d4a6...
  const char *key = "demo-card-key-0123456789";
  const uint8_t card[] = {0x04, 0xA1, 0xB2, 0xC3, 0xD4};
  uint8_t ref[kCardRefLength];
  TEST_ASSERT_TRUE(makeCardRef(key, strlen(key), card, sizeof(card), ref));
  assertHex("cb9df64f51649bd4d49e89943ffef155", ref, kCardRefLength);
}

void test_card_ref_rejects_bad_lengths() {
  const uint8_t card[11] = {0};
  uint8_t ref[kCardRefLength];
  TEST_ASSERT_FALSE(makeCardRef("k", 1, card, 0, ref));
  TEST_ASSERT_FALSE(makeCardRef("k", 1, card, 11, ref));
}

// ---- Card list ----

void test_blank_eeprom_becomes_empty_list() {
  FakeEeprom e;
  CardList list(e);
  TEST_ASSERT_TRUE(list.begin());   // was blank -> formatted
  TEST_ASSERT_EQUAL(0, list.count());
  TEST_ASSERT_EQUAL(63, list.capacity());  // (1024 - 4) / 16
  CardList again(e);
  TEST_ASSERT_FALSE(again.begin());  // valid now -> left alone
}

void test_add_find_and_survive_reboot() {
  FakeEeprom e;
  CardList list(e);
  list.begin();
  uint8_t a[kCardRefLength], b[kCardRefLength];
  refFor(1, a);
  refFor(2, b);
  TEST_ASSERT_EQUAL(static_cast<int>(AddResult::Added), static_cast<int>(list.add(a)));
  TEST_ASSERT_TRUE(list.contains(a));
  TEST_ASSERT_FALSE(list.contains(b));
  CardList afterReboot(e);
  afterReboot.begin();
  TEST_ASSERT_TRUE(afterReboot.contains(a));
  TEST_ASSERT_EQUAL(1, afterReboot.count());
}

void test_add_twice_is_not_a_duplicate() {
  FakeEeprom e;
  CardList list(e);
  list.begin();
  uint8_t a[kCardRefLength];
  refFor(1, a);
  list.add(a);
  TEST_ASSERT_EQUAL(static_cast<int>(AddResult::AlreadyListed), static_cast<int>(list.add(a)));
  TEST_ASSERT_EQUAL(1, list.count());
}

void test_list_full() {
  FakeEeprom e;
  CardList list(e);
  list.begin();
  uint8_t r[kCardRefLength];
  for (uint8_t i = 0; i < list.capacity(); i++) {
    refFor(i, r);
    TEST_ASSERT_EQUAL(static_cast<int>(AddResult::Added), static_cast<int>(list.add(r)));
  }
  refFor(200, r);
  TEST_ASSERT_EQUAL(static_cast<int>(AddResult::Full), static_cast<int>(list.add(r)));
  TEST_ASSERT_FALSE(list.contains(r));
}

void test_remove_keeps_the_others() {
  FakeEeprom e;
  CardList list(e);
  list.begin();
  uint8_t r[3][kCardRefLength];
  for (uint8_t i = 0; i < 3; i++) {
    refFor(i, r[i]);
    list.add(r[i]);
  }
  TEST_ASSERT_TRUE(list.removeAt(0));
  TEST_ASSERT_FALSE(list.contains(r[0]));
  TEST_ASSERT_TRUE(list.contains(r[1]));
  TEST_ASSERT_TRUE(list.contains(r[2]));
  TEST_ASSERT_EQUAL(2, list.count());
  TEST_ASSERT_FALSE(list.removeAt(5));
}

void test_power_cut_during_add_loses_only_that_card() {
  FakeEeprom e;
  CardList list(e);
  list.begin();
  uint8_t a[kCardRefLength], b[kCardRefLength];
  refFor(1, a);
  refFor(2, b);
  list.add(a);
  // Simulate: b's 16 bytes were written, but power died before the count.
  for (uint8_t j = 0; j < kCardRefLength; j++) e.bytes[4 + kCardRefLength + j] = b[j];
  CardList afterReboot(e);
  afterReboot.begin();
  TEST_ASSERT_TRUE(afterReboot.contains(a));
  TEST_ASSERT_FALSE(afterReboot.contains(b));
}

void test_damaged_header_is_reformatted() {
  FakeEeprom e;
  CardList list(e);
  list.begin();
  uint8_t a[kCardRefLength];
  refFor(1, a);
  list.add(a);
  e.bytes[3] = 200;  // count bigger than capacity: can't be right
  CardList afterReboot(e);
  TEST_ASSERT_TRUE(afterReboot.begin());
  TEST_ASSERT_EQUAL(0, afterReboot.count());
  TEST_ASSERT_FALSE(afterReboot.contains(a));
}

void test_clear() {
  FakeEeprom e;
  CardList list(e);
  list.begin();
  uint8_t a[kCardRefLength];
  refFor(1, a);
  list.add(a);
  list.clear();
  TEST_ASSERT_EQUAL(0, list.count());
  TEST_ASSERT_FALSE(list.contains(a));
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_sha256_abc);
  RUN_TEST(test_sha256_two_blocks);
  RUN_TEST(test_hmac_rfc4231_case_1);
  RUN_TEST(test_hmac_rfc4231_case_2);
  RUN_TEST(test_hmac_rfc4231_case_6_long_key);
  RUN_TEST(test_card_ref_matches_backend_scheme);
  RUN_TEST(test_card_ref_rejects_bad_lengths);
  RUN_TEST(test_blank_eeprom_becomes_empty_list);
  RUN_TEST(test_add_find_and_survive_reboot);
  RUN_TEST(test_add_twice_is_not_a_duplicate);
  RUN_TEST(test_list_full);
  RUN_TEST(test_remove_keeps_the_others);
  RUN_TEST(test_power_cut_during_add_loses_only_that_card);
  RUN_TEST(test_damaged_header_is_reformatted);
  RUN_TEST(test_clear);
  return UNITY_END();
}
