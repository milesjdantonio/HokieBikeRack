#include "credential_ref.h"

#include <mbedtls/md.h>
#include <string.h>

#include "device_config.h"
#include "hbr_util.h"

bool credentialKeyConfigured() { return strlen(HBR_CARD_KEY) >= 16; }

bool credentialRefFromCard(const CardId &card, std::string &outHex) {
  if (!credentialKeyConfigured() || card.length == 0) return false;
  // "hbr-card-v1:" is a label so this hash can't be confused with any other
  // use of the same key, and so we can change the scheme later (v2).
  std::string message = "hbr-card-v1:" + hbr::toHex(card.bytes, card.length);
  uint8_t mac[32];
  const mbedtls_md_info_t *sha256 = mbedtls_md_info_from_type(MBEDTLS_MD_SHA256);
  int rc = mbedtls_md_hmac(sha256, reinterpret_cast<const unsigned char *>(HBR_CARD_KEY),
                           strlen(HBR_CARD_KEY),
                           reinterpret_cast<const unsigned char *>(message.data()),
                           message.size(), mac);
  if (rc != 0) return false;
  outHex = hbr::toHex(mac, sizeof(mac));
  return true;
}
