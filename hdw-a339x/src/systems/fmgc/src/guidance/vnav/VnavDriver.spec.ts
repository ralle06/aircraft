import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApproachType } from '@flybywiresim/fbw-sdk';
import { ArmedVerticalMode, VerticalMode } from '@shared/autopilot';
import { FmgcFlightPhase } from '@shared/flightphase';
import { FmgcApproachFamily } from './FinalApproachGuidance';
import { VnavDriver } from './VnavDriver';
import { VnavPlanProfileCoherence } from './VnavProfileCoherence';

const FINAL_CAN_ENGAGE = 'L:A32NX_FG_FINAL_CAN_ENGAGE';
const FINAL_SUSTAIN_VALID = 'L:A32NX_FG_FINAL_SUSTAIN_VALID';
const TARGET_ALTITUDE = 'L:A32NX_FG_TARGET_ALTITUDE';
const TARGET_VERTICAL_SPEED = 'L:A32NX_FG_TARGET_VERTICAL_SPEED';
const REQUESTED_VERTICAL_MODE = 'L:A32NX_FG_REQUESTED_VERTICAL_MODE';
const simVarValues = new Map<string, unknown>();
const simVarWriteOrder: string[] = [];

function planAndGeometry() {
  const subject = <T>(value: T) => ({ get: () => value });
  const plan = {
    version: 1,
    activeLegIndex: 0,
    firstApproachLegIndex: 0,
    firstMissedApproachLegIndex: 0,
    destinationLegIndex: -1,
    destinationAirport: undefined,
    destinationRunway: undefined,
    approachVia: undefined,
    approach: {
      databaseId: 'APP-RNAV-A',
      type: ApproachType.Rnav,
      authorisationRequired: false,
      missedApproachAuthorisationRequired: false,
      runwayIdent: '09',
      runwayNumber: 9,
      runwayDesignator: 0,
      multipleIndicator: '',
      legs: [],
      missedLegs: [],
    },
    allLegs: [],
    performanceData: {
      cruiseFlightLevel: subject(350),
      costIndex: subject(20),
      pilotManagedDescentSpeed: subject(290),
      pilotManagedDescentMach: subject(0.8),
      descentSpeedLimitSpeed: subject(250),
      descentSpeedLimitAltitude: subject(10_000),
      preselectedClimbSpeed: subject(null),
      preselectedCruiseSpeed: subject(null),
      pilotTropopause: subject(null),
      defaultTropopause: subject(36_090),
      zeroFuelWeight: subject(175),
      blockFuel: subject(60),
      pilotTaxiFuel: subject(null),
      defaultTaxiFuel: subject(0.5),
      pilotFinalHoldingFuel: subject(null),
      pilotFinalHoldingTime: subject(null),
      defaultFinalHoldingTime: subject(30),
      pilotAlternateFuel: subject(null),
      alternateWind: subject(new Float64Array([5, 10])),
      pilotTripWind: subject(12),
      approachWindDirection: subject(90),
      approachWindMagnitude: subject(15),
      approachFlapsThreeSelected: subject(false),
      descentWindEntries: subject([]),
    },
  };
  const geometry = { legs: new Map() };

  return { plan, geometry };
}

function approachSequencePlanAndGeometry(activeLegIndex: number) {
  const { plan } = planAndGeometry();
  const procedureLeg = (ident: string, approachWaypointDescriptor?: number) => ({
    procedureIdent: ident,
    type: 1,
    overfly: false,
    waypoint: { databaseId: `FIX-${ident}`, ident, location: { lat: 1, long: 2 } },
    approachWaypointDescriptor,
    magVar: 0,
  });
  const flightPlanLeg = (ident: string, approachWaypointDescriptor?: number) => ({
    isDiscontinuity: false,
    definition: procedureLeg(ident, approachWaypointDescriptor),
    constraintType: 1,
  });
  const legDefinitions = [
    procedureLeg('ENR-0'),
    procedureLeg('ENR-1'),
    procedureLeg('ENR-2'),
    procedureLeg('APP-ENTRY'),
    procedureLeg('FAF', 2),
    procedureLeg('MAP', 5),
    procedureLeg('MISSED'),
  ];

  plan.activeLegIndex = activeLegIndex;
  plan.firstApproachLegIndex = 3;
  plan.firstMissedApproachLegIndex = 6;
  plan.destinationLegIndex = 5;
  plan.approach.legs = legDefinitions.slice(3, 6);
  plan.approach.missedLegs = legDefinitions.slice(6);
  plan.allLegs = legDefinitions.map((leg) => flightPlanLeg(leg.procedureIdent, leg.approachWaypointDescriptor));

  return {
    plan,
    geometry: {
      legs: new Map(
        legDefinitions
          .map((leg, index) => [index, { repr: leg.procedureIdent }] as const)
          .filter(([index]) => index >= activeLegIndex - 1),
      ),
    },
  };
}

function createDriver(verticalMode: VerticalMode, armedVerticalMode = 0): any {
  const driver = Object.create(VnavDriver.prototype) as any;
  const descentReset = vi.fn(() => {
    SimVar.SetSimVarValue(TARGET_ALTITUDE, 'Feet', 0);
    SimVar.SetSimVarValue(TARGET_VERTICAL_SPEED, 'number', 0);
    SimVar.SetSimVarValue(REQUESTED_VERTICAL_MODE, 'Enum', 0);
  });

  driver.flightPlanService = {
    hasActive: true,
    active: {
      approach: { type: ApproachType.Rnav, authorisationRequired: false },
    },
  };
  driver.computationParametersObserver = {
    get: () => ({
      flightPhase: FmgcFlightPhase.Approach,
      fcuVerticalMode: verticalMode,
      fcuArmedVerticalMode: armedVerticalMode,
    }),
  };
  driver.guidanceController = {
    activeGeometry: { legs: new Map() },
    getAlongTrackDistanceToDestination: vi.fn(() => 25),
  };
  driver.planProfileCoherence = { isCoherent: vi.fn(() => false) };
  driver.profileManager = {
    descentProfile: { invalidate: vi.fn() },
    mcduProfile: { invalidate: vi.fn() },
  };
  driver.aircraftToDescentProfileRelation = { reset: vi.fn() };
  driver.descentGuidance = {
    reset: descentReset,
    update: vi.fn(() => {
      SimVar.SetSimVarValue(TARGET_ALTITUDE, 'Feet', 7_777);
      SimVar.SetSimVarValue(TARGET_VERTICAL_SPEED, 'number', -777);
    }),
  };
  driver.updateDebugInformation = vi.fn();
  driver.updateHoldSpeed = vi.fn();
  driver.updateDescentSpeedGuidance = vi.fn();
  driver.updateFinalApproachGuidance = vi.fn();
  driver.activePlanDerivedDataGeneration = 0;
  driver.readyActivePlanDerivedDataGeneration = 0;
  driver.planProfileReleasePending = false;
  driver.planProfileRebuildPermitted = false;
  driver.requestDescentProfileRecomputation = false;

  return driver;
}

function invocationOrderForLastWrite(name: string): number {
  return simVarWriteOrder.lastIndexOf(name);
}

beforeEach(() => {
  vi.clearAllMocks();
  simVarValues.clear();
  simVarWriteOrder.length = 0;
  vi.stubGlobal('SimVar', {
    GetSimVarValue: vi.fn((name: string) => simVarValues.get(name) ?? 0),
    SetSimVarValue: vi.fn((name: string, _unit: string, value: unknown) => {
      simVarValues.set(name, value);
      simVarWriteOrder.push(name);
      return Promise.resolve();
    }),
  });
});

describe('FINAL capture/sustain target lifecycle', () => {
  it('does not clear active FINAL targets when only capture eligibility is lost', () => {
    const driver = createDriver(VerticalMode.FINAL);
    simVarValues.set(TARGET_ALTITUDE, 1_894);
    simVarValues.set(TARGET_VERTICAL_SPEED, -800);

    driver.publishFinalApproachGuidance(FmgcApproachFamily.Rnav, false, true);
    driver.clearInvalidArmedFinalPrefill(true);

    expect(SimVar.GetSimVarValue(FINAL_CAN_ENGAGE, 'Bool')).toBe(false);
    expect(SimVar.GetSimVarValue(FINAL_SUSTAIN_VALID, 'Bool')).toBe(true);
    expect(driver.descentGuidance.reset).not.toHaveBeenCalled();
    expect(SimVar.GetSimVarValue(TARGET_ALTITUDE, 'Feet')).toBe(1_894);
    expect(SimVar.GetSimVarValue(TARGET_VERTICAL_SPEED, 'number')).toBe(-800);
  });

  it('retains the last live target sample while active FINAL awaits a genuine generated release', () => {
    const driver = createDriver(VerticalMode.FINAL, 1 << ArmedVerticalMode.FINAL);
    simVarValues.set(TARGET_ALTITUDE, 1_894);
    simVarValues.set(TARGET_VERTICAL_SPEED, -800);

    driver.publishFinalApproachGuidance(FmgcApproachFamily.Rnav, false, false);
    driver.clearInvalidArmedFinalPrefill(false);

    const sustainReleaseOrder = invocationOrderForLastWrite(FINAL_SUSTAIN_VALID);
    expect(sustainReleaseOrder).toBeGreaterThanOrEqual(0);
    expect(driver.descentGuidance.reset).not.toHaveBeenCalled();
    expect(SimVar.GetSimVarValue(TARGET_ALTITUDE, 'Feet')).toBe(1_894);
    expect(SimVar.GetSimVarValue(TARGET_VERTICAL_SPEED, 'number')).toBe(-800);
  });

  it.each([VerticalMode.ALT, VerticalMode.OP_DES])(
    'clears invalid armed-FINAL prefill without making active mode %s a VPATH consumer',
    (verticalMode) => {
      const driver = createDriver(verticalMode, 1 << ArmedVerticalMode.FINAL);

      driver.clearInvalidArmedFinalPrefill(false);

      expect(driver.descentGuidance.reset).toHaveBeenCalledOnce();
      expect(SimVar.GetSimVarValue(TARGET_ALTITUDE, 'Feet')).toBe(0);
      expect(SimVar.GetSimVarValue(TARGET_VERTICAL_SPEED, 'number')).toBe(0);
    },
  );

  it('leaves DES target ownership unchanged when FINAL sustain becomes invalid', () => {
    const driver = createDriver(VerticalMode.DES, 1 << ArmedVerticalMode.FINAL);

    driver.clearInvalidArmedFinalPrefill(false);

    expect(driver.descentGuidance.reset).not.toHaveBeenCalled();
  });
});

describe('active-plan/descent-profile release ordering', () => {
  it('treats the authoritative active-plan replacement event as an ownership boundary', () => {
    const driver = createDriver(VerticalMode.ALT);
    const { plan, geometry } = planAndGeometry();
    const coherence = new VnavPlanProfileCoherence();
    coherence.markRebuilt(plan as any, geometry as any);
    driver.planProfileCoherence = coherence;
    driver.profileManager.mcduProfile = { invalidate: vi.fn() };
    driver.guidanceController.pseudoWaypoints = { acceptVerticalProfile: vi.fn() };

    const generation = driver.invalidateFlightPlanProfile();

    expect(driver.requestDescentProfileRecomputation).toBe(true);
    expect(driver.planProfileReleasePending).toBe(true);
    expect(SimVar.GetSimVarValue(FINAL_CAN_ENGAGE, 'Bool')).toBe(false);
    expect(driver.activePlanDerivedDataGeneration).toBe(generation);
    expect(driver.readyActivePlanDerivedDataGeneration).not.toBe(generation);
    expect(coherence.isCoherent(plan as any, geometry as any)).toBe(false);
    expect(driver.profileManager.mcduProfile.invalidate).toHaveBeenCalledOnce();
  });

  it.each([
    [3, 4],
    [4, 5],
  ])('keeps active FINAL and live targets across normal leg sequencing %s -> %s', (fromLegIndex, toLegIndex) => {
    const driver = createDriver(VerticalMode.FINAL);
    const { plan, geometry: profileGeometry } = approachSequencePlanAndGeometry(fromLegIndex);
    const { geometry: sequencedGeometry } = approachSequencePlanAndGeometry(toLegIndex);
    const coherence = new VnavPlanProfileCoherence();
    coherence.markRebuilt(plan as any, profileGeometry as any);
    plan.activeLegIndex = toLegIndex;
    plan.version++;
    driver.flightPlanService.active = plan;
    driver.guidanceController.activeGeometry = sequencedGeometry;
    driver.planProfileCoherence = coherence;
    simVarValues.set(TARGET_ALTITUDE, 1_894);
    simVarValues.set(TARGET_VERTICAL_SPEED, -500);

    driver.update(100);

    expect(coherence.isCoherent(plan as any, sequencedGeometry as any)).toBe(true);
    expect(driver.activePlanDerivedDataGeneration).toBe(driver.readyActivePlanDerivedDataGeneration);
    expect(driver.planProfileReleasePending).toBe(false);
    expect(driver.descentGuidance.reset).not.toHaveBeenCalled();
    expect(driver.profileManager.descentProfile.invalidate).not.toHaveBeenCalled();
    expect(driver.aircraftToDescentProfileRelation.reset).not.toHaveBeenCalled();
    expect(driver.descentGuidance.update).toHaveBeenCalledOnce();
    expect(driver.updateFinalApproachGuidance).toHaveBeenCalledOnce();
    expect(vi.mocked(SimVar.SetSimVarValue)).not.toHaveBeenCalledWith(FINAL_CAN_ENGAGE, 'Bool', false);
    expect(vi.mocked(SimVar.SetSimVarValue)).not.toHaveBeenCalledWith(TARGET_ALTITUDE, 'Feet', 0);
    expect(vi.mocked(SimVar.SetSimVarValue)).not.toHaveBeenCalledWith(TARGET_VERTICAL_SPEED, 'number', 0);
    expect(SimVar.GetSimVarValue(TARGET_ALTITUDE, 'Feet')).toBe(7_777);
    expect(SimVar.GetSimVarValue(TARGET_VERTICAL_SPEED, 'number')).toBe(-777);
  });

  it('releases active FINAL when sequencing also changes downstream leg geometry', () => {
    const driver = createDriver(VerticalMode.FINAL);
    const { plan, geometry: profileGeometry } = approachSequencePlanAndGeometry(4);
    const { geometry: sequencedGeometry } = approachSequencePlanAndGeometry(5);
    const coherence = new VnavPlanProfileCoherence();
    coherence.markRebuilt(plan as any, profileGeometry as any);
    plan.activeLegIndex = 5;
    plan.version++;
    sequencedGeometry.legs.set(5, { repr: 'MAP-CHANGED' });
    driver.flightPlanService.active = plan;
    driver.guidanceController.activeGeometry = sequencedGeometry;
    driver.planProfileCoherence = coherence;

    driver.update(100);

    expect(driver.descentGuidance.update).not.toHaveBeenCalled();
    expect(driver.updateFinalApproachGuidance).not.toHaveBeenCalled();
    expect(SimVar.GetSimVarValue(FINAL_CAN_ENGAGE, 'Bool')).toBe(false);
    expect(driver.descentGuidance.reset).toHaveBeenCalledOnce();
    expect(driver.profileManager.descentProfile.invalidate).toHaveBeenCalledOnce();
    expect(driver.aircraftToDescentProfileRelation.reset).toHaveBeenCalledOnce();
  });

  it('releases active FINAL immediately for an equal-version same-route performance swap', () => {
    const driver = createDriver(VerticalMode.FINAL);
    const { plan: planA, geometry } = planAndGeometry();
    const { plan: planB } = planAndGeometry();
    const coherence = new VnavPlanProfileCoherence();
    coherence.markRebuilt(planA as any, geometry as any);
    planB.performanceData.pilotManagedDescentSpeed = { get: () => 305 };
    driver.flightPlanService.active = planB;
    driver.guidanceController.activeGeometry = geometry;
    driver.planProfileCoherence = coherence;

    driver.update(100);

    const releaseOrder = invocationOrderForLastWrite(FINAL_CAN_ENGAGE);
    const sustainReleaseOrder = invocationOrderForLastWrite(FINAL_SUSTAIN_VALID);
    expect(releaseOrder).toBeGreaterThanOrEqual(0);
    expect(sustainReleaseOrder).toBeGreaterThanOrEqual(0);
    expect(sustainReleaseOrder).toBeLessThan(invocationOrderForLastWrite(TARGET_ALTITUDE));
    expect(sustainReleaseOrder).toBeLessThan(invocationOrderForLastWrite(TARGET_VERTICAL_SPEED));
    expect(releaseOrder).toBeLessThan(invocationOrderForLastWrite(TARGET_ALTITUDE));
    expect(releaseOrder).toBeLessThan(invocationOrderForLastWrite(TARGET_VERTICAL_SPEED));
    expect(driver.descentGuidance.update).not.toHaveBeenCalled();
    expect(driver.profileManager.descentProfile.invalidate).toHaveBeenCalledOnce();
  });

  it('releases active FINAL before clearing stale targets on RNAV-to-RNAV replacement', () => {
    const driver = createDriver(VerticalMode.FINAL);
    const { plan: planA, geometry } = planAndGeometry();
    const { plan: planB } = planAndGeometry();
    const coherence = new VnavPlanProfileCoherence();
    coherence.markRebuilt(planA as any, geometry as any);
    planB.approach.databaseId = 'APP-RNAV-B';
    driver.flightPlanService.active = planB;
    driver.guidanceController.activeGeometry = geometry;
    driver.planProfileCoherence = coherence;

    driver.update(100);

    const releaseOrder = invocationOrderForLastWrite(FINAL_CAN_ENGAGE);
    const sustainReleaseOrder = invocationOrderForLastWrite(FINAL_SUSTAIN_VALID);
    expect(releaseOrder).toBeGreaterThanOrEqual(0);
    expect(sustainReleaseOrder).toBeGreaterThanOrEqual(0);
    expect(SimVar.GetSimVarValue(FINAL_CAN_ENGAGE, 'Bool')).toBe(false);
    expect(SimVar.GetSimVarValue(FINAL_SUSTAIN_VALID, 'Bool')).toBe(false);
    expect(sustainReleaseOrder).toBeLessThan(invocationOrderForLastWrite(TARGET_ALTITUDE));
    expect(sustainReleaseOrder).toBeLessThan(invocationOrderForLastWrite(TARGET_VERTICAL_SPEED));
    expect(sustainReleaseOrder).toBeLessThan(invocationOrderForLastWrite(REQUESTED_VERTICAL_MODE));
    expect(releaseOrder).toBeLessThan(invocationOrderForLastWrite(TARGET_ALTITUDE));
    expect(releaseOrder).toBeLessThan(invocationOrderForLastWrite(TARGET_VERTICAL_SPEED));
    expect(releaseOrder).toBeLessThan(invocationOrderForLastWrite(REQUESTED_VERTICAL_MODE));
    expect(driver.descentGuidance.update).not.toHaveBeenCalled();
    expect(SimVar.GetSimVarValue(TARGET_ALTITUDE, 'Feet')).not.toBe(7_777);
    expect(SimVar.GetSimVarValue(TARGET_VERTICAL_SPEED, 'number')).not.toBe(-777);
    expect(vi.mocked(SimVar.SetSimVarValue)).not.toHaveBeenCalledWith(TARGET_ALTITUDE, 'Feet', 7_777);
    expect(vi.mocked(SimVar.SetSimVarValue)).not.toHaveBeenCalledWith(TARGET_VERTICAL_SPEED, 'number', -777);
    expect(driver.profileManager.descentProfile.invalidate).toHaveBeenCalledOnce();
    expect(driver.aircraftToDescentProfileRelation.reset).toHaveBeenCalledOnce();
  });

  it('stops armed-FINAL prefill before an incoherent profile can update targets', () => {
    const driver = createDriver(VerticalMode.ALT, 1 << ArmedVerticalMode.FINAL);
    const { plan: planA, geometry } = planAndGeometry();
    const { plan: planB } = planAndGeometry();
    const coherence = new VnavPlanProfileCoherence();
    coherence.markRebuilt(planA as any, geometry as any);
    planB.firstMissedApproachLegIndex = 1;
    driver.flightPlanService.active = planB;
    driver.guidanceController.activeGeometry = geometry;
    driver.planProfileCoherence = coherence;

    driver.update(100);

    expect(SimVar.GetSimVarValue(FINAL_CAN_ENGAGE, 'Bool')).toBe(false);
    expect(driver.descentGuidance.update).not.toHaveBeenCalled();
    expect(driver.descentGuidance.reset).toHaveBeenCalledOnce();
  });

  it('stops armed-FINAL prefill for an equal-version same-route Mach change', () => {
    const driver = createDriver(VerticalMode.ALT, 1 << ArmedVerticalMode.FINAL);
    const { plan: planA, geometry } = planAndGeometry();
    const { plan: planB } = planAndGeometry();
    const coherence = new VnavPlanProfileCoherence();
    coherence.markRebuilt(planA as any, geometry as any);
    planB.performanceData.pilotManagedDescentMach = { get: () => 0.84 };
    driver.flightPlanService.active = planB;
    driver.guidanceController.activeGeometry = geometry;
    driver.planProfileCoherence = coherence;

    driver.update(100);

    expect(SimVar.GetSimVarValue(FINAL_CAN_ENGAGE, 'Bool')).toBe(false);
    expect(driver.descentGuidance.update).not.toHaveBeenCalled();
    expect(driver.descentGuidance.reset).toHaveBeenCalledOnce();
  });

  it('resumes FINAL processing only after the equal-version replacement profile is marked rebuilt', () => {
    const driver = createDriver(VerticalMode.FINAL);
    const { plan: planA, geometry } = planAndGeometry();
    const { plan: planB } = planAndGeometry();
    const coherence = new VnavPlanProfileCoherence();
    planB.approach.databaseId = 'APP-RNAV-B';
    coherence.markRebuilt(planA as any, geometry as any);
    driver.flightPlanService.active = planB;
    driver.guidanceController.activeGeometry = geometry;
    driver.planProfileCoherence = coherence;

    driver.update(100);
    expect(driver.descentGuidance.update).not.toHaveBeenCalled();
    expect(driver.updateFinalApproachGuidance).not.toHaveBeenCalled();

    coherence.markRebuilt(planB as any, geometry as any);
    driver.update(100);

    expect(driver.descentGuidance.update).toHaveBeenCalledOnce();
    expect(driver.updateFinalApproachGuidance).toHaveBeenCalledOnce();
  });

  it('rebuilds an equal-version performance replacement before FINAL processing resumes', () => {
    const driver = createDriver(VerticalMode.FINAL);
    const { plan: planA, geometry } = planAndGeometry();
    const { plan: planB } = planAndGeometry();
    geometry.legs.set(0, { repr: 'DUMMY' });
    const coherence = new VnavPlanProfileCoherence();
    coherence.markRebuilt(planA as any, geometry as any);
    planB.performanceData.pilotManagedDescentSpeed = { get: () => 305 };
    driver.flightPlanService.active = planB;
    driver.flightPlanService.hasTemporary = false;
    driver.guidanceController.activeGeometry = geometry;
    driver.guidanceController.pseudoWaypoints = { acceptVerticalProfile: vi.fn() };
    driver.planProfileCoherence = coherence;

    const computeDescentPath = vi.fn();
    driver.computationParametersObserver.canComputeProfile = () => true;
    driver.computationParametersObserver.get = () => ({
      flightPhase: FmgcFlightPhase.Approach,
      fcuVerticalMode: VerticalMode.FINAL,
      fcuArmedVerticalMode: 0,
      managedDescentSpeed: 305,
    });
    driver.constraintReader = { updateFlightPlan: vi.fn(), distanceToPresentPosition: 0 };
    driver.currentMcduSpeedProfile = { update: vi.fn() };
    driver.profileManager = {
      computeTacticalMcduPath: vi.fn(),
      computeDescentPath,
      descentProfile: { findVerticalCheckpoint: vi.fn(() => null), invalidate: vi.fn() },
      mcduProfile: { isReadyToDisplay: false, invalidate: vi.fn() },
      computeTacticalNdProfile: vi.fn(),
      computeVerticalProfileForExpediteClimb: vi.fn(),
    };
    driver.descentGuidance.updateProfile = vi.fn();
    driver.updateLegSpeedPredictions = vi.fn();
    driver.oldLegs = new Map();
    driver.lastParameters = null;
    driver.prevMcduPredReadyToDisplay = false;
    driver.version = 0;

    // GuidanceController calls the periodic recompute callback before update().
    // It must not let a new owner hide the release that update() still owes.
    driver.recompute(geometry as any);
    expect(computeDescentPath).not.toHaveBeenCalled();

    driver.update(100);
    expect(driver.descentGuidance.update).not.toHaveBeenCalled();
    expect(SimVar.GetSimVarValue(FINAL_CAN_ENGAGE, 'Bool')).toBe(false);

    driver.recompute(geometry as any);

    expect(computeDescentPath).toHaveBeenCalledOnce();
    expect(coherence.isCoherent(planB as any, geometry as any)).toBe(true);

    driver.update(100);
    expect(driver.descentGuidance.update).toHaveBeenCalledOnce();
    expect(driver.updateFinalApproachGuidance).toHaveBeenCalledOnce();
  });

  it.each([
    [
      'destination fuel',
      {
        estimatedDestinationFuel: 8_000,
        approachSpeed: 145,
        flapRetractionSpeed: 165,
        slatRetractionSpeed: 185,
        cleanSpeed: 205,
      },
      {
        estimatedDestinationFuel: 12_000,
        approachSpeed: 145,
        flapRetractionSpeed: 165,
        slatRetractionSpeed: 185,
        cleanSpeed: 205,
      },
    ],
    [
      'approach/configuration speeds',
      {
        estimatedDestinationFuel: 8_000,
        approachSpeed: 140,
        flapRetractionSpeed: 160,
        slatRetractionSpeed: 180,
        cleanSpeed: 200,
      },
      {
        estimatedDestinationFuel: 8_000,
        approachSpeed: 150,
        flapRetractionSpeed: 170,
        slatRetractionSpeed: 190,
        cleanSpeed: 210,
      },
    ],
    [
      'destination fuel and approach/configuration speeds',
      {
        estimatedDestinationFuel: 8_000,
        approachSpeed: 140,
        flapRetractionSpeed: 160,
        slatRetractionSpeed: 180,
        cleanSpeed: 200,
      },
      {
        estimatedDestinationFuel: 12_000,
        approachSpeed: 150,
        flapRetractionSpeed: 170,
        slatRetractionSpeed: 190,
        cleanSpeed: 210,
      },
    ],
  ])('blocks an equal-version active/secondary swap until Plan B owns fresh %s', (_name, stale, fresh) => {
    const driver = createDriver(VerticalMode.FINAL);
    const { plan: planA, geometry } = planAndGeometry();
    const { plan: planB } = planAndGeometry();
    geometry.legs.set(0, { repr: 'DUMMY' });
    const coherence = new VnavPlanProfileCoherence();
    coherence.markRebuilt(planA as any, geometry as any);
    driver.flightPlanService.active = planB;
    driver.flightPlanService.hasTemporary = false;
    driver.guidanceController.activeGeometry = geometry;
    driver.guidanceController.pseudoWaypoints = { acceptVerticalProfile: vi.fn() };
    driver.planProfileCoherence = coherence;

    let parameters = {
      flightPhase: FmgcFlightPhase.Approach,
      fcuVerticalMode: VerticalMode.FINAL,
      fcuArmedVerticalMode: 0,
      managedDescentSpeed: 290,
      ...stale,
    };
    const inputsUsedForBuild: unknown[] = [];
    const computeDescentPath = vi.fn(() => inputsUsedForBuild.push(parameters));
    driver.computationParametersObserver = {
      canComputeProfile: () => true,
      get: () => parameters,
    };
    driver.constraintReader = { updateFlightPlan: vi.fn(), distanceToPresentPosition: 0 };
    driver.currentMcduSpeedProfile = { update: vi.fn() };
    driver.profileManager = {
      computeTacticalMcduPath: vi.fn(),
      computeDescentPath,
      descentProfile: { findVerticalCheckpoint: vi.fn(() => null), invalidate: vi.fn() },
      mcduProfile: { isReadyToDisplay: false, invalidate: vi.fn() },
      computeTacticalNdProfile: vi.fn(),
      computeVerticalProfileForExpediteClimb: vi.fn(),
    };
    driver.descentGuidance.updateProfile = vi.fn();
    driver.updateLegSpeedPredictions = vi.fn();
    driver.oldLegs = new Map();
    driver.lastParameters = null;
    driver.prevMcduPredReadyToDisplay = false;
    driver.version = 0;

    const generation = driver.invalidateFlightPlanProfile();

    // Geometry expiration can collide with activation, but Plan A cache values
    // may not be accepted while the active-plan generation is still incomplete.
    driver.recompute(geometry as any);
    expect(computeDescentPath).not.toHaveBeenCalled();

    driver.update(100);
    expect(SimVar.GetSimVarValue(FINAL_CAN_ENGAGE, 'Bool')).toBe(false);
    expect(SimVar.GetSimVarValue(TARGET_ALTITUDE, 'Feet')).toBe(0);
    expect(SimVar.GetSimVarValue(TARGET_VERTICAL_SPEED, 'number')).toBe(0);
    expect(driver.descentGuidance.update).not.toHaveBeenCalled();

    driver.recompute(geometry as any);
    expect(computeDescentPath).not.toHaveBeenCalled();
    expect(coherence.isCoherent(planB as any, geometry as any)).toBe(false);

    parameters = { ...parameters, ...fresh };
    driver.completeActivePlanDerivedDataRefresh(generation);
    driver.recompute(geometry as any);

    expect(computeDescentPath).toHaveBeenCalledOnce();
    expect(inputsUsedForBuild).toEqual([parameters]);
    expect(coherence.isCoherent(planB as any, geometry as any)).toBe(true);

    driver.update(100);
    expect(driver.descentGuidance.update).toHaveBeenCalledOnce();
    expect(driver.updateFinalApproachGuidance).toHaveBeenCalledOnce();
  });

  it('does not let an obsolete cache-refresh completion open a newer active-plan barrier', () => {
    const driver = createDriver(VerticalMode.FINAL);
    const { plan, geometry } = planAndGeometry();
    const coherence = new VnavPlanProfileCoherence();
    coherence.markRebuilt(plan as any, geometry as any);
    driver.planProfileCoherence = coherence;
    driver.guidanceController.pseudoWaypoints = { acceptVerticalProfile: vi.fn() };

    const firstGeneration = driver.invalidateFlightPlanProfile();
    const secondGeneration = driver.invalidateFlightPlanProfile();
    driver.completeActivePlanDerivedDataRefresh(firstGeneration);

    expect(driver.readyActivePlanDerivedDataGeneration).not.toBe(secondGeneration);

    driver.completeActivePlanDerivedDataRefresh(secondGeneration);
    expect(driver.readyActivePlanDerivedDataGeneration).toBe(secondGeneration);
  });

  it.each([
    ['destination fuel', 'estimatedDestinationFuel', 100],
    ['approach speed', 'approachSpeed', 1],
    ['flap retraction speed', 'flapRetractionSpeed', 1],
    ['slat retraction speed', 'slatRetractionSpeed', 1],
    ['clean speed', 'cleanSpeed', 1],
  ])('periodically rebuilds for a material same-plan %s refresh without losing ownership', (_name, field, delta) => {
    const driver = createDriver(VerticalMode.FINAL);
    const { plan, geometry } = planAndGeometry();
    const coherence = new VnavPlanProfileCoherence();
    coherence.markRebuilt(plan as any, geometry as any);
    driver.planProfileCoherence = coherence;
    driver.flightPlanService.hasTemporary = false;
    driver.didLegsChange = vi.fn(() => false);
    driver.lastParameters = {
      flightPhase: FmgcFlightPhase.Approach,
      cruiseAltitude: 35_000,
      managedDescentSpeed: 290,
      managedDescentSpeedMach: 0.8,
      estimatedDestinationFuel: 8_000,
      approachSpeed: 145,
      flapRetractionSpeed: 165,
      slatRetractionSpeed: 185,
      cleanSpeed: 205,
      approachQnh: 1_013,
      approachTemperature: 15,
      descentSpeedLimit: { speed: 250, underAltitude: 10_000 },
    };
    const newParameters = {
      ...driver.lastParameters,
      [field]: driver.lastParameters[field] + delta,
    };

    expect(driver.shouldUpdateDescentProfile(newParameters, geometry.legs)).toBe(true);
    expect(coherence.isCoherent(plan as any, geometry as any)).toBe(true);
    expect(driver.activePlanDerivedDataGeneration).toBe(driver.readyActivePlanDerivedDataGeneration);
  });

  it('ignores sub-threshold same-plan fuel and speed refresh noise', () => {
    const driver = createDriver(VerticalMode.FINAL);
    driver.flightPlanService.hasTemporary = false;
    driver.didLegsChange = vi.fn(() => false);
    driver.lastParameters = {
      flightPhase: FmgcFlightPhase.Approach,
      cruiseAltitude: 35_000,
      managedDescentSpeed: 290,
      managedDescentSpeedMach: 0.8,
      estimatedDestinationFuel: 8_000,
      approachSpeed: 145,
      flapRetractionSpeed: 165,
      slatRetractionSpeed: 185,
      cleanSpeed: 205,
      approachQnh: 1_013,
      approachTemperature: 15,
      descentSpeedLimit: { speed: 250, underAltitude: 10_000 },
    };
    const newParameters = {
      ...driver.lastParameters,
      estimatedDestinationFuel: 8_099,
      approachSpeed: 145.9,
      flapRetractionSpeed: 165.9,
      slatRetractionSpeed: 185.9,
      cleanSpeed: 205.9,
    };

    expect(driver.shouldUpdateDescentProfile(newParameters, new Map())).toBe(false);
  });
});
