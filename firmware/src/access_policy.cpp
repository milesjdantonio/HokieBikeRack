#include "access_policy.h"

AccessDecision accessPolicyCheck(const CardId& card) {
  // TODO: compare `card` against a local list of allowed cards.
  // Note: matching card IDs alone is a prototype shortcut; IDs can be copied.
  return AccessDecision::Deny;  // safe default: deny until real logic exists
}
