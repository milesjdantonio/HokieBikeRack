#pragma once
// Decides whether a card is allowed. Owner: Person A
// No hardware code here, so it can be tested on its own.
// Must work without Wi-Fi: never allow a card just because the network is down.
#include "card_reader.h"

enum class AccessDecision { Allow, Deny };

AccessDecision accessPolicyCheck(const CardId& card);
