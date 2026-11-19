// SHA-256 and HMAC-SHA256, written out so the Uno needs no crypto library (FIPS 180-4, RFC 2104).
// Checked against the standard test vectors in test/test_card_list.
#include "hmac_sha256.h"

#include <string.h>

#ifdef __AVR__
#include <avr/pgmspace.h>
#define HBR_READ_K(i) pgm_read_dword(&kRoundConstants[i])
#else
#define PROGMEM
#define HBR_READ_K(i) kRoundConstants[i]
#endif

namespace hbr {

namespace {
// First 32 bits of the fractional parts of the cube roots of the first 64 primes.
const uint32_t kRoundConstants[64] PROGMEM = {
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
};

inline uint32_t rotr(uint32_t x, uint8_t n) { return (x >> n) | (x << (32 - n)); }
}  // namespace

void Sha256::reset() {
  static const uint32_t kInitial[8] = {0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
                                       0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19};
  memcpy(state_, kInitial, sizeof(state_));
  blockUsed_ = 0;
  totalLength_ = 0;
}

void Sha256::processBlock() {
  // The 64-word message schedule is computed in a rolling 16-word window to
  // save RAM (64 bytes instead of 256).
  uint32_t w[16];
  for (uint8_t i = 0; i < 16; i++) {
    w[i] = (uint32_t)block_[4 * i] << 24 | (uint32_t)block_[4 * i + 1] << 16 |
           (uint32_t)block_[4 * i + 2] << 8 | (uint32_t)block_[4 * i + 3];
  }
  uint32_t a = state_[0], b = state_[1], c = state_[2], d = state_[3];
  uint32_t e = state_[4], f = state_[5], g = state_[6], h = state_[7];
  for (uint8_t i = 0; i < 64; i++) {
    if (i >= 16) {
      uint32_t w15 = w[(i - 15) & 15], w2 = w[(i - 2) & 15];
      uint32_t s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >> 3);
      uint32_t s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >> 10);
      w[i & 15] += s0 + w[(i - 7) & 15] + s1;
    }
    uint32_t S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
    uint32_t ch = (e & f) ^ (~e & g);
    uint32_t t1 = h + S1 + ch + HBR_READ_K(i) + w[i & 15];
    uint32_t S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
    uint32_t maj = (a & b) ^ (a & c) ^ (b & c);
    uint32_t t2 = S0 + maj;
    h = g;
    g = f;
    f = e;
    e = d + t1;
    d = c;
    c = b;
    b = a;
    a = t1 + t2;
  }
  state_[0] += a; state_[1] += b; state_[2] += c; state_[3] += d;
  state_[4] += e; state_[5] += f; state_[6] += g; state_[7] += h;
}

void Sha256::update(const uint8_t *data, size_t length) {
  for (size_t i = 0; i < length; i++) {
    block_[blockUsed_++] = data[i];
    if (blockUsed_ == 64) {
      processBlock();
      blockUsed_ = 0;
    }
  }
  totalLength_ += length;
}

void Sha256::finish(uint8_t digest[32]) {
  // Padding: a 1 bit, zeros, then the message length in bits (64-bit big-endian).
  uint64_t bitLength = (uint64_t)totalLength_ * 8;
  block_[blockUsed_++] = 0x80;
  if (blockUsed_ > 56) {
    while (blockUsed_ < 64) block_[blockUsed_++] = 0;
    processBlock();
    blockUsed_ = 0;
  }
  while (blockUsed_ < 56) block_[blockUsed_++] = 0;
  for (int8_t i = 7; i >= 0; i--) block_[blockUsed_++] = (uint8_t)(bitLength >> (8 * i));
  processBlock();
  for (uint8_t i = 0; i < 8; i++) {
    digest[4 * i] = (uint8_t)(state_[i] >> 24);
    digest[4 * i + 1] = (uint8_t)(state_[i] >> 16);
    digest[4 * i + 2] = (uint8_t)(state_[i] >> 8);
    digest[4 * i + 3] = (uint8_t)state_[i];
  }
  reset();
}

void hmacSha256(const uint8_t *key, size_t keyLength, const uint8_t *message,
                size_t messageLength, uint8_t mac[32]) {
  // HMAC = H((K ^ opad) || H((K ^ ipad) || message)), with K padded to 64 bytes
  // (and hashed first if it is longer than 64 bytes).
  uint8_t pad[64] = {0};
  Sha256 sha;
  if (keyLength > 64) {
    sha.update(key, keyLength);
    sha.finish(pad);  // the 32-byte hash, rest stays zero
  } else {
    memcpy(pad, key, keyLength);
  }
  for (uint8_t i = 0; i < 64; i++) pad[i] ^= 0x36;
  uint8_t inner[32];
  sha.update(pad, 64);
  sha.update(message, messageLength);
  sha.finish(inner);
  for (uint8_t i = 0; i < 64; i++) pad[i] ^= 0x36 ^ 0x5c;  // ipad -> opad
  sha.update(pad, 64);
  sha.update(inner, 32);
  sha.finish(mac);
}

}  // namespace hbr
