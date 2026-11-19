#pragma once
// SHA-256 and HMAC-SHA256 in plain C++. Owner: Person A
//
// The ESP32 had these built in (mbedtls). The Arduino Uno doesn't, so this is
// a small standard implementation (FIPS 180-4 and RFC 2104). It is checked
// against the official test vectors in firmware/test/test_card_list, so it
// gives exactly the same answers as Python's hmac module and the backend.
//
// On the Uno the 256-byte constant table lives in flash (PROGMEM), not in
// the 2 KB of RAM.
#include <stddef.h>
#include <stdint.h>

namespace hbr {

class Sha256 {
 public:
  Sha256() { reset(); }
  // Start a new message.
  void reset();
  // Add more bytes of the message (can be called many times).
  void update(const uint8_t *data, size_t length);
  void finish(uint8_t digest[32]);  // also resets, ready for the next message

 private:
  void processBlock();
  uint32_t state_[8];
  uint8_t block_[64];
  uint8_t blockUsed_;
  uint32_t totalLength_;  // bytes; 4 GB is plenty for card IDs
};

// HMAC-SHA256(key, message) -> 32-byte `mac`.
void hmacSha256(const uint8_t *key, size_t keyLength, const uint8_t *message,
                size_t messageLength, uint8_t mac[32]);

}  // namespace hbr
