// Card ID -> keyed reference (HMAC-SHA256 with HBR_CARD_KEY), so the raw card ID is never stored or
// printed. What each function does: include/credential_ref.h. The maths: lib/hbr_logic/src/card_list.cpp.
#include "credential_ref.h"

#include <string.h>

#include "device_config.h"

bool credentialKeyConfigured() { return strlen(HBR_CARD_KEY) >= 16; }

bool credentialRefFromCard(const CardId &card, uint8_t out[hbr::kCardRefLength]) {
  if (!credentialKeyConfigured()) return false;
  return hbr::makeCardRef(HBR_CARD_KEY, strlen(HBR_CARD_KEY), card.bytes, card.length, out);
}

bool credentialMacFromCard(const CardId &card, uint8_t out[hbr::kCardMacLength]) {
  if (!credentialKeyConfigured()) return false;
  return hbr::makeCardMac(HBR_CARD_KEY, strlen(HBR_CARD_KEY), card.bytes, card.length, out);
}
