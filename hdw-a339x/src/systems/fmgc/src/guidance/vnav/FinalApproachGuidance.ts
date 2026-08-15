// Copyright (c) 2026 Headwind Simulations
// SPDX-License-Identifier: GPL-3.0

import { ApproachType, ApproachWaypointDescriptor } from '@flybywiresim/fbw-sdk';
import { ReadonlyFlightPlan } from '@fmgc/flightplanning/plans/ReadonlyFlightPlan';

/** Must stay numerically aligned with the generated FMGC fmgc_approach_type enum. */
export enum FmgcApproachFamily {
  None = 0,
  Ils = 1,
  Rnav = 2,
}

// No dedicated coded-final envelope exists in this source tree. These bounds use
// the existing FCU/FPA representation: 0.1 degree resolution and a 9.9 degree limit.
export const MIN_FINAL_DESCENT_ANGLE_MAGNITUDE = 0.1;
export const MAX_FINAL_DESCENT_ANGLE_MAGNITUDE = 9.9;

export function isValidFinalDescentAngle(angle: number): boolean {
  const magnitude = -angle;

  return (
    Number.isFinite(angle) &&
    magnitude >= MIN_FINAL_DESCENT_ANGLE_MAGNITUDE &&
    magnitude <= MAX_FINAL_DESCENT_ANGLE_MAGNITUDE
  );
}

/**
 * Classifies only approach families implemented by the generated longitudinal/lateral logic.
 * LOC uses the existing ILS-family localizer logic; LOC backcourse remains selected separately.
 */
export function classifyFmgcApproachFamily(plan: ReadonlyFlightPlan | undefined): FmgcApproachFamily {
  const approach = plan?.approach;
  if (approach === undefined || approach.authorisationRequired) {
    return FmgcApproachFamily.None;
  }

  switch (approach.type) {
    case ApproachType.Ils:
    case ApproachType.Loc:
      return FmgcApproachFamily.Ils;
    case ApproachType.Rnav:
    case ApproachType.Gps:
      return FmgcApproachFamily.Rnav;
    default:
      return FmgcApproachFamily.None;
  }
}

/** Conventional RNAV/GPS approaches supported by the existing FMGC FINAL mode. */
export function isSupportedFinalApproach(plan: ReadonlyFlightPlan): boolean {
  return classifyFmgcApproachFamily(plan) === FmgcApproachFamily.Rnav;
}

/**
 * Checks that the active leg is on an uninterrupted, explicitly coded final path.
 *
 * ConstraintReader currently synthesizes a -3 degree angle when navdata omits one.
 * That fallback remains suitable for ordinary VNAV, but is intentionally not used to
 * claim dedicated FINAL capability without evidence that the coded path is valid.
 */
export function hasUsableFinalPath(plan: ReadonlyFlightPlan, verticalProfileValid: boolean): boolean {
  if (!verticalProfileValid || !plan.isApproachActive || !isSupportedFinalApproach(plan)) {
    return false;
  }

  let fafIndex = -1;
  let mapIndex = -1;
  for (let i = plan.firstApproachLegIndex; i < plan.firstMissedApproachLegIndex; i++) {
    const element = plan.maybeElementAt(i);
    if (element?.isDiscontinuity !== false) {
      continue;
    }

    if (element.definition.approachWaypointDescriptor === ApproachWaypointDescriptor.FinalApproachFix) {
      fafIndex = i;
    }
    if (element.definition.approachWaypointDescriptor === ApproachWaypointDescriptor.MissedApproachPoint) {
      mapIndex = i;
    }
  }

  const finalAngle =
    plan.destinationLeg?.isDiscontinuity === false ? plan.destinationLeg.definition.verticalAngle : NaN;
  const finalAltitude = plan.approach?.legs.find(
    (leg) => leg.approachWaypointDescriptor === ApproachWaypointDescriptor.MissedApproachPoint,
  )?.altitude1;

  if (
    fafIndex < 0 ||
    mapIndex <= fafIndex ||
    plan.activeLegIndex > mapIndex ||
    plan.activeLegIndex >= plan.firstMissedApproachLegIndex ||
    !isValidFinalDescentAngle(finalAngle) ||
    !Number.isFinite(finalAltitude)
  ) {
    return false;
  }

  for (let i = plan.activeLegIndex; i <= mapIndex; i++) {
    if (plan.maybeElementAt(i)?.isDiscontinuity !== false) {
      return false;
    }
  }

  return true;
}

export interface FinalApproachGuidanceAvailability {
  approachFamily: FmgcApproachFamily;
  /** Persistent path/profile validity. This deliberately excludes the instantaneous capture envelope. */
  finalSustainValid: boolean;
  /** Persistent FINAL validity plus the instantaneous VPATH capture envelope. */
  finalCanEngage: boolean;
}

/** Keeps approach selection independent from instantaneous vertical capture eligibility. */
export function getFinalApproachGuidanceAvailability(
  plan: ReadonlyFlightPlan,
  verticalProfileValid: boolean,
  pathCaptureEligible: boolean,
  finalApproachPhaseActive: boolean,
): FinalApproachGuidanceAvailability {
  const approachFamily = classifyFmgcApproachFamily(plan);
  const finalSustainValid =
    finalApproachPhaseActive &&
    approachFamily === FmgcApproachFamily.Rnav &&
    hasUsableFinalPath(plan, verticalProfileValid);

  return {
    approachFamily,
    finalSustainValid,
    finalCanEngage: finalSustainValid && pathCaptureEligible,
  };
}
