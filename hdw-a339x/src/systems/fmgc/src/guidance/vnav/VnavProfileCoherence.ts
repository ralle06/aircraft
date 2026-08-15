// Copyright (c) 2026 Headwind Simulations
// SPDX-License-Identifier: GPL-3.0

import { ReadonlyFlightPlan } from '@fmgc/flightplanning/plans/ReadonlyFlightPlan';
import { Geometry } from '@fmgc/guidance/Geometry';
import { Leg } from '@fmgc/guidance/lnav/legs/Leg';

type GeometryLegRevision = Pick<Leg, 'repr'>;

/** Compares actual geometry representations, including legs removed from either map. */
export function didVnavGeometryLegsChange(
  oldLegs: ReadonlyMap<number, GeometryLegRevision>,
  newLegs: ReadonlyMap<number, GeometryLegRevision>,
  activeLegIndex: number,
): boolean {
  const indices = new Set([...oldLegs.keys(), ...newLegs.keys()]);

  for (const index of indices) {
    if (index >= activeLegIndex && oldLegs.get(index)?.repr !== newLegs.get(index)?.repr) {
      return true;
    }
  }

  return false;
}

function databaseItemRevision(item: any): unknown[] | undefined {
  if (item === undefined || item === null) {
    return undefined;
  }

  return [
    item.databaseId,
    item.ident,
    item.location?.lat,
    item.location?.long,
    item.location?.alt,
    item.thresholdLocation?.lat,
    item.thresholdLocation?.long,
    item.thresholdLocation?.alt,
  ];
}

function procedureLegRevision(leg: any): unknown[] {
  return [
    leg.procedureIdent,
    leg.type,
    leg.overfly,
    databaseItemRevision(leg.waypoint),
    databaseItemRevision(leg.recommendedNavaid),
    leg.rho,
    leg.theta,
    databaseItemRevision(leg.arcCentreFix),
    leg.arcRadius,
    leg.length,
    leg.lengthTime,
    leg.rnp,
    leg.altitudeDescriptor,
    leg.altitude1,
    leg.altitude2,
    leg.speed,
    leg.speedDescriptor,
    leg.turnDirection,
    leg.course,
    leg.verticalAngle,
    leg.approachWaypointDescriptor,
    leg.waypointDescriptor,
    leg.magVar,
  ];
}

function flightPlanElementRevision(element: any): unknown[] {
  if (element?.isDiscontinuity !== false) {
    return ['DISCONTINUITY'];
  }

  return [
    'LEG',
    procedureLegRevision(element.definition),
    element.constraintType,
    element.altitudeConstraint?.altitudeDescriptor,
    element.altitudeConstraint?.altitude1,
    element.altitudeConstraint?.altitude2,
    element.speedConstraint?.speedDescriptor,
    element.speedConstraint?.speed,
    element.pilotEnteredAltitudeConstraint?.altitudeDescriptor,
    element.pilotEnteredAltitudeConstraint?.altitude1,
    element.pilotEnteredAltitudeConstraint?.altitude2,
    element.pilotEnteredSpeedConstraint?.speedDescriptor,
    element.pilotEnteredSpeedConstraint?.speed,
    element.cruiseStep?.toAltitude,
    element.cruiseStep?.distanceBeforeTermination,
  ];
}

function windVectorRevision(vector: ArrayLike<number> | null | undefined): unknown[] | undefined {
  return vector === null || vector === undefined ? undefined : [vector[0], vector[1]];
}

function windEntriesRevision(entries: readonly any[] | null | undefined): unknown[] {
  return (entries ?? []).map((entry) => [entry.altitude, windVectorRevision(entry.vector)]);
}

/**
 * Active-plan performance inputs that can reach managed descent/approach profile construction.
 * Continuously changing aircraft state and cached fuel/approach predictions are intentionally
 * excluded; their plan-scoped source data is represented here instead.
 */
function performanceDataRevision(performanceData: ReadonlyFlightPlan['performanceData'] | undefined): unknown[] {
  if (performanceData === undefined) {
    return [];
  }

  const pilotManagedDescentSpeed = performanceData.pilotManagedDescentSpeed.get();
  const pilotTropopause = performanceData.pilotTropopause.get();
  const pilotTaxiFuel = performanceData.pilotTaxiFuel.get();
  const pilotFinalHoldingFuel = performanceData.pilotFinalHoldingFuel.get();
  const pilotFinalHoldingTime = performanceData.pilotFinalHoldingTime.get();

  return [
    performanceData.cruiseFlightLevel.get(),
    pilotManagedDescentSpeed ?? ['COST_INDEX', performanceData.costIndex.get() ?? 0],
    performanceData.pilotManagedDescentMach.get(),
    performanceData.descentSpeedLimitSpeed.get(),
    performanceData.descentSpeedLimitAltitude.get(),
    performanceData.preselectedClimbSpeed.get(),
    performanceData.preselectedCruiseSpeed.get(),
    pilotTropopause ?? performanceData.defaultTropopause.get(),
    performanceData.zeroFuelWeight.get(),
    performanceData.blockFuel.get(),
    pilotTaxiFuel ?? performanceData.defaultTaxiFuel.get(),
    pilotFinalHoldingFuel ?? ['HOLDING_TIME', pilotFinalHoldingTime ?? performanceData.defaultFinalHoldingTime.get()],
    performanceData.pilotAlternateFuel.get(),
    windVectorRevision(performanceData.alternateWind.get()),
    performanceData.pilotTripWind.get(),
    performanceData.approachWindDirection.get(),
    performanceData.approachWindMagnitude.get(),
    performanceData.approachFlapsThreeSelected.get(),
    windEntriesRevision(performanceData.descentWindEntries.get()),
  ];
}

/**
 * Stable subset of the active plan that can affect the descent profile or FINAL
 * path. Active-leg sequencing and geometry-cache progress are intentionally absent.
 */
export function getVnavPlanProfileSignature(plan: ReadonlyFlightPlan): string {
  const approach = plan.approach;
  // The concrete FlightPlan exposes this, while the read-only interface currently does not.
  // It affects the destination fuel estimate used to seed descent predictions.
  const alternateDestinationAirport = (plan as ReadonlyFlightPlan & { alternateDestinationAirport?: unknown })
    .alternateDestinationAirport;

  return JSON.stringify([
    plan.firstApproachLegIndex,
    plan.firstMissedApproachLegIndex,
    plan.destinationLegIndex,
    databaseItemRevision(plan.destinationAirport),
    databaseItemRevision(plan.destinationRunway),
    databaseItemRevision(alternateDestinationAirport),
    plan.approachVia?.databaseId,
    approach === undefined
      ? undefined
      : [
          approach.databaseId,
          approach.type,
          approach.authorisationRequired,
          approach.missedApproachAuthorisationRequired,
          approach.runwayIdent,
          approach.runwayNumber,
          approach.runwayDesignator,
          approach.multipleIndicator,
          approach.legs.map(procedureLegRevision),
          approach.missedLegs.map(procedureLegRevision),
        ],
    plan.allLegs.map(flightPlanElementRevision),
    performanceDataRevision(plan.performanceData),
  ]);
}

function copyGeometryLegRevisions(legs: ReadonlyMap<number, GeometryLegRevision>): Map<number, GeometryLegRevision> {
  return new Map([...legs].map(([index, leg]) => [index, { repr: leg.repr }]));
}

/** Tracks the exact active-plan revision/signature used to build the current profile. */
export class VnavPlanProfileCoherence {
  private profilePlanVersion: number | undefined;

  private profilePlanSignature: string | undefined;

  private profileGeometryLegs: Map<number, GeometryLegRevision> | undefined;

  hasProfileOwner(): boolean {
    return (
      this.profilePlanVersion !== undefined &&
      this.profilePlanSignature !== undefined &&
      this.profileGeometryLegs !== undefined
    );
  }

  isCoherent(plan: ReadonlyFlightPlan, geometry: Geometry): boolean {
    if (!this.hasProfileOwner()) {
      return false;
    }

    const currentSignature = getVnavPlanProfileSignature(plan);
    if (currentSignature !== this.profilePlanSignature) {
      return false;
    }

    // Geometry trims legs behind the aircraft whenever the active leg advances.
    // Compare only the active and downstream geometry, where a representation
    // change can still affect the owned vertical profile.
    if (didVnavGeometryLegsChange(this.profileGeometryLegs!, geometry.legs, plan.activeLegIndex)) {
      return false;
    }

    // Numeric versions are local to a plan instance, so equality cannot prove
    // coherence after an active/secondary swap. The signature is authoritative;
    // version changes with the same signature remain harmless (for example normal
    // active-leg sequencing).
    this.profilePlanVersion = plan.version;
    this.profileGeometryLegs = copyGeometryLegRevisions(geometry.legs);
    return true;
  }

  markRebuilt(plan: ReadonlyFlightPlan, geometry: Geometry): void {
    this.profilePlanVersion = plan.version;
    this.profilePlanSignature = getVnavPlanProfileSignature(plan);
    this.profileGeometryLegs = copyGeometryLegRevisions(geometry.legs);
  }

  reset(): void {
    this.profilePlanVersion = undefined;
    this.profilePlanSignature = undefined;
    this.profileGeometryLegs = undefined;
  }
}
