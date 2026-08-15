import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RequestedVerticalMode } from '@fmgc/guidance/ControlLaws';
import { GuidanceController } from '@fmgc/guidance/GuidanceController';
import { AtmosphericConditions } from '@fmgc/guidance/vnav/AtmosphericConditions';
import { AircraftToDescentProfileRelation } from '@fmgc/guidance/vnav/descent/AircraftToProfileRelation';
import { NavGeometryProfile } from '@fmgc/guidance/vnav/profile/NavGeometryProfile';
import { VerticalProfileComputationParametersObserver } from '@fmgc/guidance/vnav/VerticalProfileComputationParameters';
import { ArmedVerticalMode, VerticalMode } from '@shared/autopilot';
import { FmgcFlightPhase } from '@shared/flightphase';
import { AircraftConfig } from '../../../flightplanning/AircraftConfigTypes';
import { DescentGuidance } from './DescentGuidance';

const arincState = vi.hoisted(() => ({ verticalSpeed: null as number | null }));

vi.mock('@flybywiresim/fbw-sdk', () => ({
  Arinc429Word: {
    fromSimVarValue: () => ({
      isNormalOperation: () => arincState.verticalSpeed !== null,
      value: arincState.verticalSpeed ?? 0,
    }),
  },
}));

vi.mock('./SpeedMargin', () => ({
  SpeedMargin: class {
    getMargins(target: number): [number, number] {
      return [target - 20, target + 20];
    }
  },
}));

vi.mock('./TodGuidance', () => ({
  TodGuidance: class {
    update(): void {}
  },
}));

const TARGET_ALTITUDE = 'L:A32NX_FG_TARGET_ALTITUDE';
const TARGET_VERTICAL_SPEED = 'L:A32NX_FG_TARGET_VERTICAL_SPEED';
const REQUESTED_VERTICAL_MODE = 'L:A32NX_FG_REQUESTED_VERTICAL_MODE';

interface TestState {
  verticalMode: VerticalMode;
  armedVerticalMode: number;
  profileIsValid: boolean;
  linearDeviation: number;
  targetVerticalSpeed: number;
}

interface TestContext {
  guidance: DescentGuidance;
  invalidProfile: NavGeometryProfile;
  state: TestState;
}

function output(name: string): number {
  return SimVar.GetSimVarValue(name, 'number');
}

function writesFor(name: string): number[] {
  return vi
    .mocked(SimVar.SetSimVarValue)
    .mock.calls.filter(([simVarName]) => simVarName === name)
    .map(([, , value]) => value as number);
}

function createGuidance(verticalMode: VerticalMode): TestContext {
  const state: TestState = {
    verticalMode,
    armedVerticalMode: 0,
    profileIsValid: true,
    linearDeviation: 40,
    targetVerticalSpeed: -700,
  };
  const validProfile = {} as NavGeometryProfile;
  const invalidProfile = {} as NavGeometryProfile;

  const relation = {
    get isValid() {
      return state.profileIsValid;
    },
    update: vi.fn(),
    updateProfile: vi.fn((profile: NavGeometryProfile) => {
      state.profileIsValid = profile !== invalidProfile;
    }),
    currentTargetAltitude: vi.fn(() => 6_000),
    computeLinearDeviation: vi.fn(() => state.linearDeviation),
    currentTargetVerticalSpeed: vi.fn(() => state.targetVerticalSpeed),
    currentTargetPathAngle: vi.fn(() => -3),
    isOnGeometricPath: vi.fn(() => true),
    isAboveSpeedLimitAltitude: vi.fn(() => true),
    isCloseToAirfieldElevation: vi.fn(() => false),
    isPastTopOfDescent: vi.fn(() => true),
  } as unknown as AircraftToDescentProfileRelation;
  const observer = {
    get: () => ({
      fcuVerticalMode: state.verticalMode,
      fcuArmedVerticalMode: state.armedVerticalMode,
      flightPhase: FmgcFlightPhase.Descent,
      fcuSpeed: 250,
      managedDescentSpeed: 280,
      managedDescentSpeedMach: 0.78,
      approachSpeed: 140,
    }),
  } as VerticalProfileComputationParametersObserver;
  const atmosphericConditions = {
    currentPressureAltitude: 10_000,
    currentAirspeed: 250,
  } as AtmosphericConditions;
  const guidanceController = {
    isManualHoldActive: () => false,
  } as GuidanceController;
  const config = {
    vnavConfig: {
      VMO: 330,
      MMO: 0.86,
    },
  } as AircraftConfig;

  const guidance = new DescentGuidance(config, guidanceController, relation, observer, atmosphericConditions);
  guidance.updateProfile(validProfile);

  return { guidance, invalidProfile, state };
}

beforeEach(() => {
  vi.clearAllMocks();
  arincState.verticalSpeed = null;
  SimVar.GetGameVarValue = vi.fn(() => 300);
  vi.stubGlobal('Simplane', {
    getAutoPilotAirspeedManaged: () => false,
  });
});

describe('VPATH target lifecycle', () => {
  it('treats a valid zero vertical speed as capture data instead of using the unavailable-data fallback', () => {
    const { guidance, state } = createGuidance(VerticalMode.ALT);
    arincState.verticalSpeed = 0;
    state.linearDeviation = 150;
    state.targetVerticalSpeed = -2_000;

    expect(guidance.isPathCaptureEligible()).toBe(true);
  });

  it('reports the exact capture threshold and signed margin without changing the capture equation', () => {
    const { guidance, state } = createGuidance(VerticalMode.FINAL);
    arincState.verticalSpeed = -1_700;
    state.targetVerticalSpeed = -700;
    state.linearDeviation = 80;

    expect(guidance.getPathCaptureDiagnostics()).toEqual({
      actualVerticalSpeed: -1_700,
      targetVerticalSpeed: -700,
      captureThreshold: 100,
      captureMargin: 20,
    });
    expect(guidance.isPathCaptureEligible()).toBe(true);

    arincState.verticalSpeed = -700;

    expect(guidance.getPathCaptureDiagnostics()).toEqual({
      actualVerticalSpeed: -700,
      targetVerticalSpeed: -700,
      captureThreshold: 50,
      captureMargin: -30,
    });
    expect(guidance.isPathCaptureEligible()).toBe(false);
  });

  it('accepts and publishes a valid level pre-FAF VPATH target with zero feed-forward VS', () => {
    const { guidance, state } = createGuidance(VerticalMode.ALT);
    state.armedVerticalMode = 1 << ArmedVerticalMode.FINAL;
    state.targetVerticalSpeed = 0;
    arincState.verticalSpeed = 0;

    expect(guidance.isPathCaptureEligible()).toBe(true);

    guidance.update(100, 25);

    expect(Number.isFinite(output(TARGET_ALTITUDE))).toBe(true);
    expect(output(TARGET_ALTITUDE)).toBe(9_960);
    expect(output(TARGET_VERTICAL_SPEED)).toBe(0);
    expect(output(REQUESTED_VERTICAL_MODE)).toBe(RequestedVerticalMode.None);
  });

  it('publishes live geometry targets and the existing requested submode in DES', () => {
    const { guidance } = createGuidance(VerticalMode.DES);

    guidance.update(100, 25);

    expect(output(TARGET_ALTITUDE)).toBe(9_960);
    expect(output(TARGET_VERTICAL_SPEED)).toBe(-700);
    expect(output(REQUESTED_VERTICAL_MODE)).toBe(RequestedVerticalMode.VpathSpeed);
  });

  it('publishes live geometry targets in FINAL without synthesizing a DES requested submode', () => {
    const { guidance } = createGuidance(VerticalMode.FINAL);

    guidance.update(100, 25);

    expect(output(TARGET_ALTITUDE)).toBe(9_960);
    expect(output(TARGET_VERTICAL_SPEED)).toBe(-700);
    expect(output(REQUESTED_VERTICAL_MODE)).toBe(RequestedVerticalMode.None);
  });

  it('prefills live geometry targets while FINAL is armed in another active vertical mode', () => {
    const { guidance, state } = createGuidance(VerticalMode.ALT);
    state.armedVerticalMode = 1 << ArmedVerticalMode.FINAL;

    guidance.update(100, 25);

    expect(output(TARGET_ALTITUDE)).toBe(9_960);
    expect(output(TARGET_VERTICAL_SPEED)).toBe(-700);
    expect(output(REQUESTED_VERTICAL_MODE)).toBe(RequestedVerticalMode.None);
  });

  it('prefills targets for OP DES plus FINAL armed without making OP DES a VPATH consumer', () => {
    const { guidance, state } = createGuidance(VerticalMode.OP_DES);
    state.armedVerticalMode = 1 << ArmedVerticalMode.FINAL;

    guidance.update(100, 25);

    expect(output(TARGET_ALTITUDE)).toBe(9_960);
    expect(output(TARGET_VERTICAL_SPEED)).toBe(-700);
    expect(output(REQUESTED_VERTICAL_MODE)).toBe(RequestedVerticalMode.None);

    state.armedVerticalMode = 0;
    guidance.update(100, 24);

    expect(output(TARGET_ALTITUDE)).toBe(0);
    expect(output(TARGET_VERTICAL_SPEED)).toBe(0);
    expect(output(REQUESTED_VERTICAL_MODE)).toBe(RequestedVerticalMode.None);
  });

  it('has live targets before and during the OP DES to FINAL capture frame', () => {
    const { guidance, state } = createGuidance(VerticalMode.OP_DES);
    state.armedVerticalMode = 1 << ArmedVerticalMode.FINAL;

    guidance.update(100, 25);

    expect(output(TARGET_ALTITUDE)).toBe(9_960);
    expect(output(TARGET_VERTICAL_SPEED)).toBe(-700);

    state.verticalMode = VerticalMode.FINAL;
    state.armedVerticalMode = 0;
    state.linearDeviation = 50;
    state.targetVerticalSpeed = -710;
    vi.mocked(SimVar.SetSimVarValue).mockClear();

    guidance.update(100, 24);

    expect(writesFor(TARGET_ALTITUDE)).toEqual([9_950]);
    expect(writesFor(TARGET_VERTICAL_SPEED)).toEqual([-710]);
    expect(writesFor(REQUESTED_VERTICAL_MODE)).toEqual([RequestedVerticalMode.None]);
  });

  it('keeps non-zero targets continuous across DES to FINAL', () => {
    const { guidance, state } = createGuidance(VerticalMode.DES);
    guidance.update(100, 25);
    vi.mocked(SimVar.SetSimVarValue).mockClear();

    state.verticalMode = VerticalMode.FINAL;
    guidance.update(100, 24);

    expect(writesFor(TARGET_ALTITUDE)).toEqual([9_960]);
    expect(writesFor(TARGET_VERTICAL_SPEED)).toEqual([-700]);
    expect(writesFor(REQUESTED_VERTICAL_MODE)).toEqual([RequestedVerticalMode.None]);
  });

  it('computes targets before the first publish when entering FINAL from another mode', () => {
    const { guidance, state } = createGuidance(VerticalMode.VS);
    guidance.update(100, 25);
    vi.mocked(SimVar.SetSimVarValue).mockClear();

    state.verticalMode = VerticalMode.FINAL;
    guidance.update(100, 24);

    expect(writesFor(TARGET_ALTITUDE)).toEqual([9_960]);
    expect(writesFor(TARGET_VERTICAL_SPEED)).toEqual([-700]);
    expect(writesFor(REQUESTED_VERTICAL_MODE)).toEqual([RequestedVerticalMode.None]);
  });

  it.each([VerticalMode.ALT, VerticalMode.OP_DES])(
    'keeps targets live across armed mode %s to FINAL',
    (verticalMode) => {
      const { guidance, state } = createGuidance(verticalMode);
      state.armedVerticalMode = 1 << ArmedVerticalMode.FINAL;
      guidance.update(100, 25);

      state.verticalMode = VerticalMode.FINAL;
      state.armedVerticalMode = 0;
      vi.mocked(SimVar.SetSimVarValue).mockClear();

      guidance.update(100, 24);

      expect(writesFor(TARGET_ALTITUDE)).toEqual([9_960]);
      expect(writesFor(TARGET_VERTICAL_SPEED)).toEqual([-700]);
      expect(writesFor(REQUESTED_VERTICAL_MODE)).toEqual([RequestedVerticalMode.None]);
    },
  );

  it('updates both targets when VNAV deviation and profile vertical speed change during FINAL', () => {
    const { guidance, state } = createGuidance(VerticalMode.FINAL);
    guidance.update(100, 25);

    state.linearDeviation = 125;
    state.targetVerticalSpeed = -850;
    expect(guidance.isPathCaptureEligible()).toBe(false);
    guidance.update(100, 24);

    expect(output(TARGET_ALTITUDE)).toBe(9_875);
    expect(output(TARGET_VERTICAL_SPEED)).toBe(-850);
    expect(output(REQUESTED_VERTICAL_MODE)).toBe(RequestedVerticalMode.None);
  });

  it('keeps FINAL targets live when the capture envelope contracts after capture', () => {
    const { guidance, state } = createGuidance(VerticalMode.FINAL);
    arincState.verticalSpeed = -1_700;
    state.targetVerticalSpeed = -700;
    state.linearDeviation = 80;
    expect(guidance.isPathCaptureEligible()).toBe(true);
    guidance.update(100, 25);

    arincState.verticalSpeed = -700;
    expect(guidance.isPathCaptureEligible()).toBe(false);
    guidance.update(100, 24);

    expect(output(TARGET_ALTITUDE)).toBe(9_920);
    expect(output(TARGET_VERTICAL_SPEED)).toBe(-700);
    expect(output(REQUESTED_VERTICAL_MODE)).toBe(RequestedVerticalMode.None);
  });

  it.each([VerticalMode.DES, VerticalMode.FINAL])(
    'clears altitude, vertical speed, and requested mode after leaving consuming mode %s',
    (consumingMode) => {
      const { guidance, state } = createGuidance(consumingMode);
      guidance.update(100, 25);

      state.verticalMode = VerticalMode.VS;
      guidance.update(100, 24);

      expect(output(TARGET_ALTITUDE)).toBe(0);
      expect(output(TARGET_VERTICAL_SPEED)).toBe(0);
      expect(output(REQUESTED_VERTICAL_MODE)).toBe(RequestedVerticalMode.None);
    },
  );

  it('clears all targets when FINAL is disarmed without becoming active', () => {
    const { guidance, state } = createGuidance(VerticalMode.ALT);
    state.armedVerticalMode = 1 << ArmedVerticalMode.FINAL;
    guidance.update(100, 25);

    state.armedVerticalMode = 0;
    guidance.update(100, 24);

    expect(output(TARGET_ALTITUDE)).toBe(0);
    expect(output(TARGET_VERTICAL_SPEED)).toBe(0);
    expect(output(REQUESTED_VERTICAL_MODE)).toBe(RequestedVerticalMode.None);
  });

  it('clears all targets on go-around after FINAL', () => {
    const { guidance, state } = createGuidance(VerticalMode.FINAL);
    guidance.update(100, 25);

    state.verticalMode = VerticalMode.SRS_GA;
    guidance.update(100, 24);

    expect(output(TARGET_ALTITUDE)).toBe(0);
    expect(output(TARGET_VERTICAL_SPEED)).toBe(0);
    expect(output(REQUESTED_VERTICAL_MODE)).toBe(RequestedVerticalMode.None);
  });

  it('clears all VPATH state when the profile is reset as invalid during FINAL', () => {
    const { guidance, invalidProfile } = createGuidance(VerticalMode.FINAL);
    guidance.update(100, 25);

    guidance.updateProfile(invalidProfile);

    expect(output(TARGET_ALTITUDE)).toBe(0);
    expect(output(TARGET_VERTICAL_SPEED)).toBe(0);
    expect(output(REQUESTED_VERTICAL_MODE)).toBe(RequestedVerticalMode.None);
  });

  it('clears all VPATH state when the profile becomes invalid while FINAL is armed', () => {
    const { guidance, invalidProfile, state } = createGuidance(VerticalMode.OP_DES);
    state.armedVerticalMode = 1 << ArmedVerticalMode.FINAL;
    guidance.update(100, 25);

    guidance.updateProfile(invalidProfile);

    expect(output(TARGET_ALTITUDE)).toBe(0);
    expect(output(TARGET_VERTICAL_SPEED)).toBe(0);
    expect(output(REQUESTED_VERTICAL_MODE)).toBe(RequestedVerticalMode.None);
  });

  it('publishes deterministic zero VPATH state when reset directly', () => {
    const { guidance } = createGuidance(VerticalMode.FINAL);
    guidance.update(100, 25);
    vi.mocked(SimVar.SetSimVarValue).mockClear();

    guidance.reset();

    expect(writesFor(TARGET_ALTITUDE)).toEqual([0]);
    expect(writesFor(TARGET_VERTICAL_SPEED)).toEqual([0]);
    expect(writesFor(REQUESTED_VERTICAL_MODE)).toEqual([RequestedVerticalMode.None]);
  });
});
