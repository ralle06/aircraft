import { describe, expect, it } from 'vitest';
import { ApproachType, ApproachWaypointDescriptor } from '@flybywiresim/fbw-sdk';
import { ReadonlyFlightPlan } from '@fmgc/flightplanning/plans/ReadonlyFlightPlan';
import {
  classifyFmgcApproachFamily,
  FmgcApproachFamily,
  getFinalApproachGuidanceAvailability,
  hasUsableFinalPath,
  isSupportedFinalApproach,
  isValidFinalDescentAngle,
  MAX_FINAL_DESCENT_ANGLE_MAGNITUDE,
  MIN_FINAL_DESCENT_ANGLE_MAGNITUDE,
} from './FinalApproachGuidance';

const leg = (descriptor: ApproachWaypointDescriptor, altitude1?: number, verticalAngle?: number) => ({
  isDiscontinuity: false,
  definition: { approachWaypointDescriptor: descriptor, verticalAngle },
  approachWaypointDescriptor: descriptor,
  altitude1,
});

function plan(type: ApproachType, overrides: Record<string, unknown> = {}): ReadonlyFlightPlan {
  const legs = [
    leg(ApproachWaypointDescriptor.InitialApproachFix),
    leg(ApproachWaypointDescriptor.FinalApproachFix),
    leg(ApproachWaypointDescriptor.MissedApproachPoint, 120, -3),
  ];
  return {
    approach: { type, authorisationRequired: false, legs },
    isApproachActive: true,
    firstApproachLegIndex: 0,
    firstMissedApproachLegIndex: 3,
    activeLegIndex: 0,
    destinationLeg: legs[2],
    maybeElementAt: (index: number) => legs[index],
    ...overrides,
  } as unknown as ReadonlyFlightPlan;
}

describe('FINAL approach classification', () => {
  it('classifies no active flight plan as no generated approach family', () => {
    expect(classifyFmgcApproachFamily(undefined)).toBe(FmgcApproachFamily.None);
  });

  it.each([ApproachType.Rnav, ApproachType.Gps])('supports conventional RNAV/GPS (%s)', (type) => {
    expect(isSupportedFinalApproach(plan(type))).toBe(true);
    expect(isSupportedFinalApproach(plan(type, { isApproachActive: false }))).toBe(true);
  });

  it.each([ApproachType.Vor, ApproachType.Ndb, ApproachType.Gls, ApproachType.Unknown, ApproachType.LocBackcourse])(
    'inhibits unsupported type %s',
    (type) => {
      expect(isSupportedFinalApproach(plan(type))).toBe(false);
      expect(classifyFmgcApproachFamily(plan(type))).toBe(FmgcApproachFamily.None);
    },
  );

  it.each([ApproachType.Ils, ApproachType.Loc])('classifies the generated LOC/G/S family (%s)', (type) => {
    expect(isSupportedFinalApproach(plan(type))).toBe(false);
    expect(classifyFmgcApproachFamily(plan(type))).toBe(FmgcApproachFamily.Ils);
  });

  it.each([ApproachType.Rnav, ApproachType.Gps])('classifies the generated FINAL family (%s)', (type) => {
    expect(classifyFmgcApproachFamily(plan(type))).toBe(FmgcApproachFamily.Rnav);
  });

  it('inhibits RNP AR and a removed approach', () => {
    expect(isSupportedFinalApproach(plan(ApproachType.Rnav, { approach: undefined }))).toBe(false);
    expect(classifyFmgcApproachFamily(plan(ApproachType.Rnav, { approach: undefined }))).toBe(FmgcApproachFamily.None);
    expect(
      isSupportedFinalApproach(
        plan(ApproachType.Rnav, {
          approach: { ...plan(ApproachType.Rnav).approach, authorisationRequired: true },
        }),
      ),
    ).toBe(false);
    expect(
      classifyFmgcApproachFamily(
        plan(ApproachType.Rnav, {
          approach: { ...plan(ApproachType.Rnav).approach, authorisationRequired: true },
        }),
      ),
    ).toBe(FmgcApproachFamily.None);
  });
});

describe('FINAL producer inputs before the FAF', () => {
  it('selects a loaded RNAV approach but inhibits FINAL until the approach is active', () => {
    expect(
      getFinalApproachGuidanceAvailability(plan(ApproachType.Rnav, { isApproachActive: false }), true, true, true),
    ).toEqual({
      approachFamily: FmgcApproachFamily.Rnav,
      finalSustainValid: false,
      finalCanEngage: false,
    });
  });

  it('selects RNAV and allows FINAL inside the existing capture envelope', () => {
    expect(getFinalApproachGuidanceAvailability(plan(ApproachType.Rnav), true, true, true)).toEqual({
      approachFamily: FmgcApproachFamily.Rnav,
      finalSustainValid: true,
      finalCanEngage: true,
    });
  });

  it('keeps RNAV selected but inhibits FINAL outside the existing capture envelope', () => {
    expect(getFinalApproachGuidanceAvailability(plan(ApproachType.Rnav), true, false, true)).toEqual({
      approachFamily: FmgcApproachFamily.Rnav,
      finalSustainValid: true,
      finalCanEngage: false,
    });
  });

  it('inhibits FINAL after the MAP', () => {
    expect(
      getFinalApproachGuidanceAvailability(plan(ApproachType.Rnav, { activeLegIndex: 3 }), true, true, true),
    ).toEqual({
      approachFamily: FmgcApproachFamily.Rnav,
      finalSustainValid: false,
      finalCanEngage: false,
    });
  });

  it('keeps FINAL available through the MAP leg and releases it on first-missed-leg entry', () => {
    const approachLegs = [
      leg(ApproachWaypointDescriptor.InitialApproachFix),
      leg(ApproachWaypointDescriptor.FinalApproachFix),
      leg(ApproachWaypointDescriptor.MissedApproachPoint, 120, -3),
    ];
    const indexedLegs = [undefined, undefined, undefined, ...approachLegs];
    const activePlan = plan(ApproachType.Rnav, {
      approach: { type: ApproachType.Rnav, authorisationRequired: false, legs: approachLegs },
      firstApproachLegIndex: 3,
      firstMissedApproachLegIndex: 6,
      activeLegIndex: 5,
      destinationLeg: indexedLegs[5],
      maybeElementAt: (index: number) => indexedLegs[index],
    });

    expect(getFinalApproachGuidanceAvailability(activePlan, true, true, true).finalCanEngage).toBe(true);
    expect(
      getFinalApproachGuidanceAvailability({ ...activePlan, activeLegIndex: 6 } as ReadonlyFlightPlan, true, true, true)
        .finalCanEngage,
    ).toBe(false);
  });

  it('publishes ILS family without enabling FINAL', () => {
    expect(getFinalApproachGuidanceAvailability(plan(ApproachType.Ils), true, true, true)).toEqual({
      approachFamily: FmgcApproachFamily.Ils,
      finalSustainValid: false,
      finalCanEngage: false,
    });
  });

  it('releases capture and sustain validity when the approach is removed', () => {
    expect(
      getFinalApproachGuidanceAvailability(plan(ApproachType.Rnav, { approach: undefined }), true, true, true),
    ).toEqual({
      approachFamily: FmgcApproachFamily.None,
      finalSustainValid: false,
      finalCanEngage: false,
    });
  });

  it('keeps capture and sustain invalid outside the FINAL-capable approach phase', () => {
    expect(getFinalApproachGuidanceAvailability(plan(ApproachType.Rnav), true, true, false)).toEqual({
      approachFamily: FmgcApproachFamily.Rnav,
      finalSustainValid: false,
      finalCanEngage: false,
    });
  });
});

describe('FINAL path validity', () => {
  it('accepts a finite, uninterrupted FAF-to-MAP path with a valid profile', () => {
    expect(hasUsableFinalPath(plan(ApproachType.Rnav), true)).toBe(true);
  });

  it.each([
    ['invalid profile', { profile: false }],
    ['inactive approach', { isApproachActive: false }],
    ['after MAP', { activeLegIndex: 3 }],
    ['missing final angle', { destinationLeg: leg(ApproachWaypointDescriptor.MissedApproachPoint, 120) }],
  ])('rejects %s', (_name, testCase) => {
    const { profile = true, ...overrides } = testCase as { profile?: boolean } & Record<string, unknown>;
    expect(hasUsableFinalPath(plan(ApproachType.Rnav, overrides), profile)).toBe(false);
  });

  it('rejects missing FAF, invalid MAP altitude, and a discontinuity', () => {
    const noFaf = [
      leg(ApproachWaypointDescriptor.InitialApproachFix),
      leg(ApproachWaypointDescriptor.IntermediateApproachFix),
      leg(ApproachWaypointDescriptor.MissedApproachPoint, 120, -3),
    ];
    expect(hasUsableFinalPath(plan(ApproachType.Rnav, { maybeElementAt: (i: number) => noFaf[i] }), true)).toBe(false);

    const badMap = [
      leg(ApproachWaypointDescriptor.FinalApproachFix),
      leg(ApproachWaypointDescriptor.MissedApproachPoint),
    ];
    expect(
      hasUsableFinalPath(
        plan(ApproachType.Rnav, {
          approach: { type: ApproachType.Rnav, authorisationRequired: false, legs: badMap },
        }),
        true,
      ),
    ).toBe(false);

    expect(
      hasUsableFinalPath(
        plan(ApproachType.Rnav, {
          maybeElementAt: (i: number) =>
            i === 1 ? { isDiscontinuity: true } : plan(ApproachType.Rnav).maybeElementAt(i),
        }),
        true,
      ),
    ).toBe(false);
  });
});

describe('FINAL coded descent-angle validity', () => {
  it.each([NaN, Infinity, -Infinity, 1, 0])('rejects non-descending angle %s', (angle) => {
    expect(isValidFinalDescentAngle(angle)).toBe(false);
  });

  it.each([
    ['immediately below the shallow limit', -(MIN_FINAL_DESCENT_ANGLE_MAGNITUDE - 0.0001), false],
    ['at the shallow limit', -MIN_FINAL_DESCENT_ANGLE_MAGNITUDE, true],
    ['immediately above the shallow limit', -(MIN_FINAL_DESCENT_ANGLE_MAGNITUDE + 0.0001), true],
    ['a normal coded final path', -3, true],
    ['immediately below the steep limit', -(MAX_FINAL_DESCENT_ANGLE_MAGNITUDE - 0.0001), true],
    ['at the steep limit', -MAX_FINAL_DESCENT_ANGLE_MAGNITUDE, true],
    ['immediately above the steep limit', -(MAX_FINAL_DESCENT_ANGLE_MAGNITUDE + 0.0001), false],
  ])('%s', (_name, angle, expected) => {
    expect(isValidFinalDescentAngle(angle as number)).toBe(expected);
  });

  it('applies the envelope to FINAL path availability', () => {
    const shallow = plan(ApproachType.Rnav, {
      destinationLeg: leg(
        ApproachWaypointDescriptor.MissedApproachPoint,
        120,
        -(MIN_FINAL_DESCENT_ANGLE_MAGNITUDE - 0.0001),
      ),
    });
    const steep = plan(ApproachType.Rnav, {
      destinationLeg: leg(
        ApproachWaypointDescriptor.MissedApproachPoint,
        120,
        -(MAX_FINAL_DESCENT_ANGLE_MAGNITUDE + 0.0001),
      ),
    });

    expect(hasUsableFinalPath(shallow, true)).toBe(false);
    expect(hasUsableFinalPath(steep, true)).toBe(false);
  });
});
