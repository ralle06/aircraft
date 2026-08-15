import { describe, expect, it } from 'vitest';
import { ReadonlyFlightPlan } from '@fmgc/flightplanning/plans/ReadonlyFlightPlan';
import { Geometry } from '@fmgc/guidance/Geometry';
import {
  didVnavGeometryLegsChange,
  getVnavPlanProfileSignature,
  VnavPlanProfileCoherence,
} from './VnavProfileCoherence';

interface MutableTestPlan {
  version: number;
  activeLegIndex: number;
  firstApproachLegIndex: number;
  firstMissedApproachLegIndex: number;
  destinationLegIndex: number;
  destinationAirport?: Record<string, unknown>;
  destinationRunway?: Record<string, unknown>;
  alternateDestinationAirport?: Record<string, unknown>;
  approachVia?: Record<string, unknown>;
  approach?: Record<string, any>;
  allLegs: Array<Record<string, any>>;
  performanceData: Record<string, TestSubject<any>>;
}

interface TestSubject<T> {
  value: T;
  get(): T;
  set(value: T): void;
}

function testSubject<T>(value: T): TestSubject<T> {
  return {
    value,
    get() {
      return this.value;
    },
    set(newValue) {
      this.value = newValue;
    },
  };
}

function performanceData(): MutableTestPlan['performanceData'] {
  return {
    cruiseFlightLevel: testSubject(350),
    costIndex: testSubject(20),
    pilotManagedDescentSpeed: testSubject(null),
    pilotManagedDescentMach: testSubject(null),
    descentSpeedLimitSpeed: testSubject(250),
    descentSpeedLimitAltitude: testSubject(10_000),
    preselectedClimbSpeed: testSubject(null),
    preselectedCruiseSpeed: testSubject(null),
    pilotTropopause: testSubject(null),
    defaultTropopause: testSubject(36_090),
    zeroFuelWeight: testSubject(175),
    blockFuel: testSubject(60),
    pilotTaxiFuel: testSubject(null),
    defaultTaxiFuel: testSubject(0.5),
    pilotFinalHoldingFuel: testSubject(null),
    pilotFinalHoldingTime: testSubject(null),
    defaultFinalHoldingTime: testSubject(30),
    pilotAlternateFuel: testSubject(null),
    alternateWind: testSubject(new Float64Array([5, 10])),
    pilotTripWind: testSubject(12),
    approachWindDirection: testSubject(90),
    approachWindMagnitude: testSubject(15),
    approachFlapsThreeSelected: testSubject(false),
    descentWindEntries: testSubject([{ altitude: 10_000, vector: new Float64Array([10, 20]), flags: 0 }]),
    pilotVapp: testSubject(null),
  };
}

const procedureLeg = (ident: string, descriptor?: number) => ({
  procedureIdent: ident,
  type: 1,
  overfly: false,
  waypoint: { databaseId: `FIX-${ident}`, ident, location: { lat: 1, long: 2 } },
  approachWaypointDescriptor: descriptor,
  magVar: 0,
});

const flightPlanLeg = (ident: string, descriptor?: number) => ({
  isDiscontinuity: false,
  definition: procedureLeg(ident, descriptor),
  constraintType: 1,
});

function plan(): MutableTestPlan {
  const approachLegs = [procedureLeg('FAF', 2), procedureLeg('MAP', 5)];

  return {
    version: 1,
    activeLegIndex: 0,
    firstApproachLegIndex: 0,
    firstMissedApproachLegIndex: 2,
    destinationLegIndex: 1,
    destinationAirport: { databaseId: 'APT-A', ident: 'AAAA' },
    destinationRunway: { databaseId: 'RWY-A', ident: '09' },
    alternateDestinationAirport: { databaseId: 'APT-ALT-A', ident: 'BBBB' },
    approach: {
      databaseId: 'APP-RNAV-A',
      type: 12,
      authorisationRequired: false,
      missedApproachAuthorisationRequired: false,
      runwayIdent: '09',
      runwayNumber: 9,
      runwayDesignator: 0,
      multipleIndicator: '',
      legs: approachLegs,
      missedLegs: [procedureLeg('MISSED')],
    },
    allLegs: [flightPlanLeg('FAF', 2), flightPlanLeg('MAP', 5), flightPlanLeg('MISSED')],
    performanceData: performanceData(),
  };
}

function geometry(...representations: string[]): Geometry {
  return {
    legs: new Map(representations.map((repr, index) => [index, { repr }])),
  } as unknown as Geometry;
}

function sequencingPlan(activeLegIndex: number): MutableTestPlan {
  const value = plan();
  value.activeLegIndex = activeLegIndex;
  value.firstApproachLegIndex = 3;
  value.firstMissedApproachLegIndex = 6;
  value.destinationLegIndex = 5;
  value.approach.legs = [procedureLeg('APP-ENTRY'), procedureLeg('FAF', 2), procedureLeg('MAP', 5)];
  value.approach.missedLegs = [procedureLeg('MISSED')];
  value.allLegs = [
    flightPlanLeg('ENR-0'),
    flightPlanLeg('ENR-1'),
    flightPlanLeg('ENR-2'),
    flightPlanLeg('APP-ENTRY'),
    flightPlanLeg('FAF', 2),
    flightPlanLeg('MAP', 5),
    flightPlanLeg('MISSED'),
  ];
  return value;
}

function sequencingGeometry(activeLegIndex: number, changedIndex = -1): Geometry {
  const representations = ['ENR-0', 'ENR-1', 'ENR-2', 'APP-ENTRY', 'FAF', 'MAP', 'MISSED'];
  return {
    legs: new Map(
      representations
        .map((repr, index) => [index, { repr: index === changedIndex ? `${repr}-CHANGED` : repr }] as const)
        .filter(([index]) => index >= activeLegIndex - 1),
    ),
  } as unknown as Geometry;
}

function readonlyPlan(value: MutableTestPlan): ReadonlyFlightPlan {
  return value as unknown as ReadonlyFlightPlan;
}

describe('VNAV geometry leg comparison', () => {
  it('keeps unchanged non-empty representations unchanged', () => {
    const oldLegs = geometry('TF FROM A TO B', 'CF(090.0T) TO C').legs;
    const newLegs = geometry('TF FROM A TO B', 'CF(090.0T) TO C').legs;

    expect(didVnavGeometryLegsChange(oldLegs, newLegs, 0)).toBe(false);
  });

  it('detects an actual representation change when both representations are non-empty', () => {
    const oldLegs = geometry('TF FROM A TO B').legs;
    const newLegs = geometry('TF FROM A TO C').legs;

    expect(didVnavGeometryLegsChange(oldLegs, newLegs, 0)).toBe(true);
  });

  it('detects removed and inserted geometry legs', () => {
    expect(didVnavGeometryLegsChange(geometry('A', 'B').legs, geometry('A').legs, 0)).toBe(true);
    expect(didVnavGeometryLegsChange(geometry('A').legs, geometry('A', 'B').legs, 0)).toBe(true);
  });
});

describe('active-plan/descent-profile coherence', () => {
  it('accepts an equal version only when the VNAV-relevant signature is identical', () => {
    const subject = new VnavPlanProfileCoherence();
    const profilePlan = plan();
    const identicalPlan = plan();
    const activeGeometry = geometry('FAF', 'MAP', 'MISSED');
    subject.markRebuilt(readonlyPlan(profilePlan), activeGeometry);

    expect(identicalPlan.version).toBe(profilePlan.version);
    expect(subject.isCoherent(readonlyPlan(identicalPlan), activeGeometry)).toBe(true);
  });

  it('rejects an equal-version active/secondary swap with a different RNAV signature', () => {
    const subject = new VnavPlanProfileCoherence();
    const activePlanA = plan();
    const secondaryPlanB = plan();
    const activeGeometry = geometry('FAF', 'MAP', 'MISSED');
    secondaryPlanB.approach.databaseId = 'APP-RNAV-B';
    secondaryPlanB.allLegs[0] = flightPlanLeg('FAF-B', 2);
    subject.markRebuilt(readonlyPlan(activePlanA), activeGeometry);

    expect(secondaryPlanB.version).toBe(activePlanA.version);
    expect(subject.isCoherent(readonlyPlan(secondaryPlanB), activeGeometry)).toBe(false);
  });

  it('accepts a harmless version advance when the VNAV-relevant signature is unchanged', () => {
    const subject = new VnavPlanProfileCoherence();
    const activePlan = plan();
    const activeGeometry = geometry('FAF', 'MAP', 'MISSED');
    subject.markRebuilt(readonlyPlan(activePlan), activeGeometry);

    activePlan.version++;

    expect(subject.isCoherent(readonlyPlan(activePlan), activeGeometry)).toBe(true);
  });

  it.each([
    [3, 4],
    [4, 5],
  ])('keeps profile ownership across normal active-leg sequencing %s -> %s', (fromLegIndex, toLegIndex) => {
    const subject = new VnavPlanProfileCoherence();
    const activePlan = sequencingPlan(fromLegIndex);
    subject.markRebuilt(readonlyPlan(activePlan), sequencingGeometry(fromLegIndex));

    activePlan.activeLegIndex = toLegIndex;
    activePlan.version++;

    expect(subject.isCoherent(readonlyPlan(activePlan), sequencingGeometry(toLegIndex))).toBe(true);
  });

  it('rejects a downstream geometry representation change during sequencing', () => {
    const subject = new VnavPlanProfileCoherence();
    const activePlan = sequencingPlan(4);
    subject.markRebuilt(readonlyPlan(activePlan), sequencingGeometry(4));

    activePlan.activeLegIndex = 5;
    activePlan.version++;

    expect(subject.isCoherent(readonlyPlan(activePlan), sequencingGeometry(5, 5))).toBe(false);
  });

  it('accepts an equal-version same-route replacement with identical profile performance inputs', () => {
    const subject = new VnavPlanProfileCoherence();
    const activePlanA = plan();
    const secondaryPlanB = plan();
    const activeGeometry = geometry('FAF', 'MAP', 'MISSED');
    subject.markRebuilt(readonlyPlan(activePlanA), activeGeometry);

    expect(secondaryPlanB.version).toBe(activePlanA.version);
    expect(subject.isCoherent(readonlyPlan(secondaryPlanB), activeGeometry)).toBe(true);
  });

  it.each([
    ['managed descent speed', 'pilotManagedDescentSpeed', 305],
    ['managed descent Mach', 'pilotManagedDescentMach', 0.84],
    ['cost index fallback speed', 'costIndex', 80],
    ['cruise flight level', 'cruiseFlightLevel', 370],
    ['descent speed limit', 'descentSpeedLimitSpeed', 240],
    ['descent speed limit altitude', 'descentSpeedLimitAltitude', 12_000],
    ['preselected climb speed', 'preselectedClimbSpeed', 280],
    ['preselected cruise speed', 'preselectedCruiseSpeed', 0.82],
    ['pilot tropopause', 'pilotTropopause', 38_000],
    ['default tropopause', 'defaultTropopause', 37_000],
    ['zero fuel weight', 'zeroFuelWeight', 180],
    ['block fuel', 'blockFuel', 70],
    ['pilot taxi fuel', 'pilotTaxiFuel', 0.8],
    ['default taxi fuel', 'defaultTaxiFuel', 0.7],
    ['final holding fuel', 'pilotFinalHoldingFuel', 2.5],
    ['final holding time', 'pilotFinalHoldingTime', 35],
    ['default final holding time', 'defaultFinalHoldingTime', 40],
    ['alternate fuel', 'pilotAlternateFuel', 4.5],
    ['trip wind', 'pilotTripWind', -20],
    ['approach wind direction', 'approachWindDirection', 180],
    ['approach wind magnitude', 'approachWindMagnitude', 25],
    ['approach flap configuration', 'approachFlapsThreeSelected', true],
  ])('rejects an equal-version same-route replacement with different %s', (_name, field, replacement) => {
    const subject = new VnavPlanProfileCoherence();
    const activePlanA = plan();
    const secondaryPlanB = plan();
    const activeGeometry = geometry('FAF', 'MAP', 'MISSED');
    subject.markRebuilt(readonlyPlan(activePlanA), activeGeometry);

    secondaryPlanB.performanceData[field].set(replacement);

    expect(secondaryPlanB.version).toBe(activePlanA.version);
    expect(subject.isCoherent(readonlyPlan(secondaryPlanB), activeGeometry)).toBe(false);
  });

  it.each([
    ['alternate wind', (value: MutableTestPlan) => value.performanceData.alternateWind.set(new Float64Array([20, 5]))],
    [
      'descent forecast wind',
      (value: MutableTestPlan) =>
        value.performanceData.descentWindEntries.set([
          { altitude: 10_000, vector: new Float64Array([30, 40]), flags: 0 },
        ]),
    ],
    [
      'alternate destination',
      (value: MutableTestPlan) => (value.alternateDestinationAirport = { databaseId: 'APT-ALT-B', ident: 'CCCC' }),
    ],
  ])('rejects an equal-version same-route replacement with different %s', (_name, mutate) => {
    const subject = new VnavPlanProfileCoherence();
    const activePlanA = plan();
    const secondaryPlanB = plan();
    const activeGeometry = geometry('FAF', 'MAP', 'MISSED');
    subject.markRebuilt(readonlyPlan(activePlanA), activeGeometry);

    mutate(secondaryPlanB);

    expect(secondaryPlanB.version).toBe(activePlanA.version);
    expect(subject.isCoherent(readonlyPlan(secondaryPlanB), activeGeometry)).toBe(false);
  });

  it('does not invalidate for unrelated performance-page state that does not reach profile construction', () => {
    const subject = new VnavPlanProfileCoherence();
    const activePlan = plan();
    const activeGeometry = geometry('FAF', 'MAP', 'MISSED');
    subject.markRebuilt(readonlyPlan(activePlan), activeGeometry);

    activePlan.performanceData.pilotVapp.set(145);
    activePlan.version++;

    expect(subject.isCoherent(readonlyPlan(activePlan), activeGeometry)).toBe(true);
  });

  it('inhibits a changed revision until a matching profile is rebuilt', () => {
    const subject = new VnavPlanProfileCoherence();
    const activePlan = plan();
    const activeGeometry = geometry('FAF', 'MAP', 'MISSED');
    subject.markRebuilt(readonlyPlan(activePlan), activeGeometry);

    activePlan.version++;
    activePlan.approach.databaseId = 'APP-RNAV-B';

    expect(subject.isCoherent(readonlyPlan(activePlan), activeGeometry)).toBe(false);

    subject.markRebuilt(readonlyPlan(activePlan), activeGeometry);
    expect(subject.isCoherent(readonlyPlan(activePlan), activeGeometry)).toBe(true);
  });

  it('rejects an altitude-constraint mutation', () => {
    const subject = new VnavPlanProfileCoherence();
    const activePlan = plan();
    const activeGeometry = geometry('FAF', 'MAP', 'MISSED');
    subject.markRebuilt(readonlyPlan(activePlan), activeGeometry);

    activePlan.allLegs[1].altitudeConstraint = { altitudeDescriptor: 1, altitude1: 2_000 };
    activePlan.version++;

    expect(subject.isCoherent(readonlyPlan(activePlan), activeGeometry)).toBe(false);
  });

  it.each([
    ['changed approach leg', (value: MutableTestPlan) => (value.approach.legs[0] = procedureLeg('FAF-B', 2))],
    ['inserted approach leg', (value: MutableTestPlan) => value.approach.legs.splice(1, 0, procedureLeg('STEP'))],
    ['removed approach leg', (value: MutableTestPlan) => value.approach.legs.splice(0, 1)],
    ['FAF index', (value: MutableTestPlan) => (value.firstApproachLegIndex = 1)],
    ['MAP index', (value: MutableTestPlan) => (value.firstMissedApproachLegIndex = 3)],
    ['destination index', (value: MutableTestPlan) => (value.destinationLegIndex = 2)],
  ])('rejects equal-version %s mutation', (_name, mutate) => {
    const subject = new VnavPlanProfileCoherence();
    const profilePlan = plan();
    const replacementPlan = plan();
    const activeGeometry = geometry('FAF', 'MAP', 'MISSED');
    subject.markRebuilt(readonlyPlan(profilePlan), activeGeometry);

    mutate(replacementPlan);

    expect(replacementPlan.version).toBe(profilePlan.version);
    expect(subject.isCoherent(readonlyPlan(replacementPlan), activeGeometry)).toBe(false);
  });

  it('restores coherence only after the equal-version replacement profile is rebuilt', () => {
    const subject = new VnavPlanProfileCoherence();
    const activePlanA = plan();
    const activePlanB = plan();
    const activeGeometry = geometry('FAF', 'MAP', 'MISSED');
    activePlanB.approach.databaseId = 'APP-RNAV-B';
    subject.markRebuilt(readonlyPlan(activePlanA), activeGeometry);

    expect(subject.isCoherent(readonlyPlan(activePlanB), activeGeometry)).toBe(false);

    subject.markRebuilt(readonlyPlan(activePlanB), activeGeometry);
    expect(subject.isCoherent(readonlyPlan(activePlanB), activeGeometry)).toBe(true);
  });

  it.each([
    ['RNAV A to RNAV B', (value: MutableTestPlan) => (value.approach.databaseId = 'APP-RNAV-B')],
    ['FAF index', (value: MutableTestPlan) => (value.firstApproachLegIndex = 1)],
    ['MAP index', (value: MutableTestPlan) => (value.firstMissedApproachLegIndex = 3)],
    ['approach removal', (value: MutableTestPlan) => (value.approach = undefined)],
    [
      'approach replacement',
      (value: MutableTestPlan) => (value.approach = { ...value.approach, databaseId: 'APP-REPLACEMENT' }),
    ],
    ['destination change', (value: MutableTestPlan) => (value.destinationAirport = { databaseId: 'APT-B' })],
    ['runway change', (value: MutableTestPlan) => (value.destinationRunway = { databaseId: 'RWY-B' })],
    ['discontinuity change', (value: MutableTestPlan) => (value.allLegs[1] = { isDiscontinuity: true })],
    ['missed-approach structure', (value: MutableTestPlan) => value.approach.missedLegs.push(procedureLeg('MISSED-2'))],
    [
      'approach leg resequencing',
      (value: MutableTestPlan) => value.approach.legs.splice(0, 2, procedureLeg('MAP', 5), procedureLeg('FAF', 2)),
    ],
  ])('detects %s', (_name, mutate) => {
    const activePlan = plan();
    const before = getVnavPlanProfileSignature(readonlyPlan(activePlan));

    activePlan.version++;
    mutate(activePlan);

    expect(getVnavPlanProfileSignature(readonlyPlan(activePlan))).not.toBe(before);
  });

  it('detects approach insertion', () => {
    const withoutApproach = plan();
    const insertedApproach = plan();
    withoutApproach.approach = undefined;

    expect(getVnavPlanProfileSignature(readonlyPlan(withoutApproach))).not.toBe(
      getVnavPlanProfileSignature(readonlyPlan(insertedApproach)),
    );
  });

  it('rejects same-shaped flight-plan legs when downstream computed geometry changes', () => {
    const subject = new VnavPlanProfileCoherence();
    const activePlan = plan();
    const profileGeometry = geometry('TF FROM A TO FAF', 'MAP', 'MISSED');
    subject.markRebuilt(readonlyPlan(activePlan), profileGeometry);

    expect(subject.isCoherent(readonlyPlan(activePlan), geometry('TF FROM B TO FAF', 'MAP', 'MISSED'))).toBe(false);
  });
});
