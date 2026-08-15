import { describe, expect, it, vi } from 'vitest';
import { FlightPlanIndex } from '@fmgc/flightplanning/FlightPlanManager';
import { FMCMainDisplay } from './A32NX_FMCMainDisplay';

function performanceDataValue<T>(value: T) {
  return { get: () => value };
}

function activePlan(windDirection = 270, windMagnitude = 30, runwayBearing = 270) {
  return {
    flightNumber: performanceDataValue(null),
    destinationRunway: { magneticBearing: runwayBearing },
    performanceData: {
      approachWindDirection: performanceDataValue(windDirection),
      approachWindMagnitude: performanceDataValue(windMagnitude),
    },
  };
}

function activePlanChangeHarness(plan = activePlan()) {
  const display = Object.create(FMCMainDisplay.prototype) as any;
  const calls: string[] = [];
  const completeActivePlanDerivedDataRefresh = vi.fn((generation: number) => calls.push(`complete:${generation}`));

  Object.defineProperties(display, {
    guidanceController: {
      value: {
        vnavDriver: {
          invalidateFlightPlanProfile: vi.fn(() => {
            calls.push('invalidate');
            return 7;
          }),
          completeActivePlanDerivedDataRefresh,
        },
      },
    },
    flightPlanService: {
      value: {
        hasActive: true,
        active: plan,
      },
    },
  });

  display.getFlightPlan = vi.fn(() => plan);
  display.connectPerfDataToSimvars = vi.fn(() => calls.push('connect'));
  display.updateDestinationData = vi.fn(() => calls.push('destination'));
  display.updateTowerHeadwind = vi.fn(() => {
    calls.push('tower-headwind');
    return true;
  });
  display.runFuelPredComputation = vi.fn((index: FlightPlanIndex) => calls.push(`fuel:${index}`));
  display.updatePerfSpeeds = vi.fn((useVnavPrediction: boolean) => calls.push(`speeds:${useVnavPrediction}`));

  return { display, calls, completeActivePlanDerivedDataRefresh };
}

describe('active-plan derived-cache ownership', () => {
  it('refreshes every plan-dependent cache before completing the VNAV generation', async () => {
    const { display, calls, completeActivePlanDerivedDataRefresh } = activePlanChangeHarness();

    await display.onActiveFlightPlanChanged();

    expect(calls).toEqual([
      'invalidate',
      'connect',
      'destination',
      'tower-headwind',
      `fuel:${FlightPlanIndex.Active}`,
      'speeds:false',
      'complete:7',
    ]);
    expect(completeActivePlanDerivedDataRefresh).toHaveBeenCalledWith(7);
  });

  it('keeps the VNAV generation blocked if any required cache refresh fails', async () => {
    const { display, completeActivePlanDerivedDataRefresh } = activePlanChangeHarness();
    display.runFuelPredComputation = vi.fn(() => {
      throw new Error('fuel cache refresh failed');
    });

    await expect(display.onActiveFlightPlanChanged()).rejects.toThrow('fuel cache refresh failed');

    expect(completeActivePlanDerivedDataRefresh).not.toHaveBeenCalled();
    expect(display.updatePerfSpeeds).not.toHaveBeenCalled();
  });

  it('keeps the VNAV generation blocked if the Plan B tower-headwind refresh is invalid', async () => {
    const { display, completeActivePlanDerivedDataRefresh } = activePlanChangeHarness();
    display.updateTowerHeadwind = vi.fn(() => false);

    await display.onActiveFlightPlanChanged();

    expect(display.runFuelPredComputation).not.toHaveBeenCalled();
    expect(display.updatePerfSpeeds).not.toHaveBeenCalled();
    expect(completeActivePlanDerivedDataRefresh).not.toHaveBeenCalled();
  });

  it.each([
    ['different approach wind and runway', 240, 24, 90],
    ['same runway with a different finite approach wind', 180, 18, 270],
    ['different runway with the same approach wind', 270, 30, 90],
  ])('replaces Plan A tower headwind for Plan B with %s', async (_case, direction, magnitude, bearing) => {
    const planA = activePlan();
    const planB = activePlan(direction, magnitude, bearing);
    const { display } = activePlanChangeHarness(planB);
    let selectedPlan = planA;
    display.getFlightPlan = vi.fn(() => selectedPlan);
    const planATowerHeadwindRefresh = FMCMainDisplay.prototype.updateTowerHeadwind.call(display);
    const planATowerHeadwind = display._towerHeadwind;
    selectedPlan = planB;
    display.updateTowerHeadwind = vi.fn(() => FMCMainDisplay.prototype.updateTowerHeadwind.call(display));
    let towerHeadwindUsedForPlanBSpeeds: number | undefined;
    display.updatePerfSpeeds = vi.fn(() => {
      towerHeadwindUsedForPlanBSpeeds = display._towerHeadwind;
    });

    await display.onActiveFlightPlanChanged();

    const expectedPlanBHeadwind = magnitude * Math.cos(((direction - bearing) * Math.PI) / 180);
    expect(planATowerHeadwindRefresh).toBe(true);
    expect(planATowerHeadwind).toBe(30);
    expect(towerHeadwindUsedForPlanBSpeeds).toBeCloseTo(expectedPlanBHeadwind);
    expect(towerHeadwindUsedForPlanBSpeeds).not.toBe(planATowerHeadwind);
  });

  it('clears the previous plan value when Plan B has no complete approach-wind source', () => {
    const planB = activePlan(Number.NaN, 30, 270);
    const display = Object.create(FMCMainDisplay.prototype) as any;
    display._towerHeadwind = 30;
    display.getFlightPlan = vi.fn(() => planB);

    expect(FMCMainDisplay.prototype.updateTowerHeadwind.call(display)).toBe(true);
    expect(display._towerHeadwind).toBe(0);
  });

  it('fails safely and clears the previous plan value when finite Plan B wind has no valid runway course', () => {
    const planB = activePlan(270, 30, Number.NaN);
    const display = Object.create(FMCMainDisplay.prototype) as any;
    display._towerHeadwind = -12;
    display.getFlightPlan = vi.fn(() => planB);

    expect(FMCMainDisplay.prototype.updateTowerHeadwind.call(display)).toBe(false);
    expect(display._towerHeadwind).toBe(0);
  });

  it('clears the previous plan value before a failed Plan B source read', () => {
    const display = Object.create(FMCMainDisplay.prototype) as any;
    display._towerHeadwind = 30;
    display.getFlightPlan = vi.fn(() => {
      throw new Error('active plan unavailable');
    });

    expect(() => FMCMainDisplay.prototype.updateTowerHeadwind.call(display)).toThrow('active plan unavailable');
    expect(display._towerHeadwind).toBe(0);
  });

  it('leaves the normal same-plan performance-speed call on its existing prediction path', () => {
    const plan = activePlan(Number.NaN, Number.NaN, 270) as any;
    plan.performanceData.approachFlapsThreeSelected = performanceDataValue(false);
    plan.performanceData.zeroFuelWeight = performanceDataValue(null);
    const getDestinationPrediction = vi.fn(() => null);
    const display = Object.create(FMCMainDisplay.prototype) as any;
    display.guidanceController = { vnavDriver: { getDestinationPrediction } };
    display.currFlightPhaseManager = { phase: 0 };
    display.getFlightPlan = vi.fn(() => plan);
    display.getFuelPredComputation = vi.fn(() => ({ landingWeight: 180 }));
    display.getGrossWeight = vi.fn(() => 180);
    vi.stubGlobal('SimVar', { GetSimVarValue: vi.fn(() => 0) });

    FMCMainDisplay.prototype.updatePerfSpeeds.call(display);

    expect(getDestinationPrediction).toHaveBeenCalledOnce();
    expect(display.approachSpeeds.valid).toBe(true);
  });
});
