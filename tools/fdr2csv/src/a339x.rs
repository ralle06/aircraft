use crate::{
    a339x_headers::{
        ap_raw_output, athr_output, base_ecu_bus, base_elac_analog_outputs,
        base_elac_discrete_outputs, base_elac_out_bus, base_fac_analog_outputs, base_fac_bus,
        base_fac_discrete_outputs, base_fmgc_ap_fd_logic_outputs, base_fmgc_athr_outputs,
        base_fmgc_bus_inputs, base_fmgc_bus_outputs, base_fmgc_discrete_inputs,
        base_fmgc_discrete_outputs, base_fmgc_logic_outputs, base_fms_inputs,
        base_sec_analog_outputs, base_sec_discrete_outputs, base_sec_out_bus, AircraftSpecificData,
        BaseData,
    },
    read_bytes,
};
use serde::Serialize;
use std::io::{prelude::*, Error};

pub const INTERFACE_VERSION: u64 = 3300005;

// A single FDR record
#[derive(Serialize, Default)]
pub struct FdrData {
    base: BaseData,
    specific: AircraftSpecificData,
    elac_1: ElacData,
    elac_2: ElacData,
    sec_1: SecData,
    sec_2: SecData,
    sec_3: SecData,
    fac_1: FacData,
    fac_2: FacData,
    fmgc_1: FmgcData,
    fadec_1: FadecData,
}

#[derive(Serialize, Default)]
struct FmgcData {
    logic: base_fmgc_logic_outputs,
    ap_fd_logic: base_fmgc_ap_fd_logic_outputs,
    ap_fd_outer_loops: ap_raw_output,
    athr: base_fmgc_athr_outputs,
    discrete_outputs: base_fmgc_discrete_outputs,
    bus_outputs: base_fmgc_bus_outputs,
    bus_inputs: base_fmgc_bus_inputs,
    discrete_inputs: base_fmgc_discrete_inputs,
    fms_inputs: base_fms_inputs,
}

#[derive(Serialize, Default)]
struct FadecData {
    fadec_bus_output: base_ecu_bus,
    output: athr_output,
}

#[derive(Serialize, Default)]
struct ElacData {
    bus_outputs: base_elac_out_bus,
    discrete_outputs: base_elac_discrete_outputs,
    analog_outputs: base_elac_analog_outputs,
}

#[derive(Serialize, Default)]
struct SecData {
    bus_outputs: base_sec_out_bus,
    discrete_outputs: base_sec_discrete_outputs,
    analog_outputs: base_sec_analog_outputs,
}

#[derive(Serialize, Default)]
struct FacData {
    bus_outputs: base_fac_bus,
    discrete_outputs: base_fac_discrete_outputs,
    analog_outputs: base_fac_analog_outputs,
}

// These are helper functions to read in a whole FDR record.
pub fn read_record(reader: &mut impl Read) -> Result<FdrData, Error> {
    Ok(FdrData {
        base: read_bytes::<BaseData>(reader)?,
        specific: read_bytes::<AircraftSpecificData>(reader)?,
        elac_1: read_elac(reader)?,
        elac_2: read_elac(reader)?,
        sec_1: read_sec(reader)?,
        sec_2: read_sec(reader)?,
        sec_3: read_sec(reader)?,
        fac_1: read_fac(reader)?,
        fac_2: read_fac(reader)?,
        fmgc_1: read_fmgc(reader)?,
        fadec_1: FadecData {
            fadec_bus_output: read_bytes(reader)?,
            output: read_bytes(reader)?,
        },
    })
}

fn read_fmgc(reader: &mut impl Read) -> Result<FmgcData, Error> {
    Ok(FmgcData {
        logic: read_bytes(reader)?,
        ap_fd_logic: read_bytes(reader)?,
        ap_fd_outer_loops: read_bytes(reader)?,
        athr: read_bytes(reader)?,
        discrete_outputs: read_bytes(reader)?,
        bus_outputs: read_bytes(reader)?,
        bus_inputs: read_bytes(reader)?,
        discrete_inputs: read_bytes(reader)?,
        fms_inputs: read_bytes(reader)?,
    })
}

#[cfg(test)]
fn record_size() -> usize {
    std::mem::size_of::<BaseData>()
        + std::mem::size_of::<AircraftSpecificData>()
        + 2 * (std::mem::size_of::<base_elac_out_bus>()
            + std::mem::size_of::<base_elac_discrete_outputs>()
            + std::mem::size_of::<base_elac_analog_outputs>())
        + 3 * (std::mem::size_of::<base_sec_out_bus>()
            + std::mem::size_of::<base_sec_discrete_outputs>()
            + std::mem::size_of::<base_sec_analog_outputs>())
        + 2 * (std::mem::size_of::<base_fac_bus>()
            + std::mem::size_of::<base_fac_discrete_outputs>()
            + std::mem::size_of::<base_fac_analog_outputs>())
        + std::mem::size_of::<base_fmgc_logic_outputs>()
        + std::mem::size_of::<base_fmgc_ap_fd_logic_outputs>()
        + std::mem::size_of::<ap_raw_output>()
        + std::mem::size_of::<base_fmgc_athr_outputs>()
        + std::mem::size_of::<base_fmgc_discrete_outputs>()
        + std::mem::size_of::<base_fmgc_bus_outputs>()
        + std::mem::size_of::<base_fmgc_bus_inputs>()
        + std::mem::size_of::<base_fmgc_discrete_inputs>()
        + std::mem::size_of::<base_fms_inputs>()
        + std::mem::size_of::<base_ecu_bus>()
        + std::mem::size_of::<athr_output>()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn append<T>(bytes: &mut Vec<u8>, value: &T) {
        // Bindgen's Default implementation zero-initializes these C structs,
        // including padding. This fixture intentionally models the host C++
        // ABI; it does not prove that the deployed WASM ABI is identical.
        let raw = unsafe {
            std::slice::from_raw_parts((value as *const T).cast::<u8>(), std::mem::size_of::<T>())
        };
        bytes.extend_from_slice(raw);
    }

    fn append_writer_order(bytes: &mut Vec<u8>, record: &FdrData) {
        append(bytes, &record.base);
        append(bytes, &record.specific);
        for elac in [&record.elac_1, &record.elac_2] {
            append(bytes, &elac.bus_outputs);
            append(bytes, &elac.discrete_outputs);
            append(bytes, &elac.analog_outputs);
        }
        for sec in [&record.sec_1, &record.sec_2, &record.sec_3] {
            append(bytes, &sec.bus_outputs);
            append(bytes, &sec.discrete_outputs);
            append(bytes, &sec.analog_outputs);
        }
        for fac in [&record.fac_1, &record.fac_2] {
            append(bytes, &fac.bus_outputs);
            append(bytes, &fac.discrete_outputs);
            append(bytes, &fac.analog_outputs);
        }
        let f = &record.fmgc_1;
        append(bytes, &f.logic);
        append(bytes, &f.ap_fd_logic);
        append(bytes, &f.ap_fd_outer_loops);
        append(bytes, &f.athr);
        append(bytes, &f.discrete_outputs);
        append(bytes, &f.bus_outputs);
        append(bytes, &f.bus_inputs);
        append(bytes, &f.discrete_inputs);
        append(bytes, &f.fms_inputs);
        append(bytes, &record.fadec_1.fadec_bus_output);
        append(bytes, &record.fadec_1.output);
    }

    fn sentinel(time: f64, law: i32, altitude: f64, theta: f64, n1: f32) -> FdrData {
        let mut record = FdrData::default();
        record.base.simulation_time_s = time;
        record.fmgc_1.ap_fd_logic.active_longitudinal_law = law;
        record.fmgc_1.ap_fd_logic.alt_sel_or_cstr = altitude;
        record.fmgc_1.ap_fd_outer_loops.autopilot.Theta_c_deg = theta;
        record
            .fadec_1
            .fadec_bus_output
            .selected_n1_actual_percent
            .Data = n1;
        record
    }

    #[test]
    fn current_writer_order_stays_aligned_for_two_records() {
        let mut bytes = Vec::new();
        append_writer_order(&mut bytes, &sentinel(11.0, 1, 12_000.0, 2.5, 71.0));
        append_writer_order(&mut bytes, &sentinel(22.0, 4, 13_000.0, -1.5, 82.0));
        assert_eq!(bytes.len(), record_size() * 2);

        let mut input = bytes.as_slice();
        let first = read_record(&mut input).unwrap();
        let second = read_record(&mut input).unwrap();
        assert!(input.is_empty());
        assert_eq!(first.base.simulation_time_s, 11.0);
        assert_eq!(second.base.simulation_time_s, 22.0);
        assert_eq!(first.fmgc_1.ap_fd_logic.active_longitudinal_law, 1);
        assert_eq!(second.fmgc_1.ap_fd_logic.active_longitudinal_law, 4);
        assert_eq!(first.fmgc_1.ap_fd_logic.alt_sel_or_cstr, 12_000.0);
        assert_eq!(second.fmgc_1.ap_fd_logic.alt_sel_or_cstr, 13_000.0);
        assert_eq!(first.fmgc_1.ap_fd_outer_loops.autopilot.Theta_c_deg, 2.5);
        assert_eq!(second.fmgc_1.ap_fd_outer_loops.autopilot.Theta_c_deg, -1.5);
        assert_eq!(
            first
                .fadec_1
                .fadec_bus_output
                .selected_n1_actual_percent
                .Data,
            71.0
        );
        assert_eq!(
            second
                .fadec_1
                .fadec_bus_output
                .selected_n1_actual_percent
                .Data,
            82.0
        );
    }

    #[test]
    fn partial_record_is_an_error() {
        let mut bytes = Vec::new();
        append_writer_order(&mut bytes, &FdrData::default());
        bytes.extend_from_slice(&[0; 17]);
        let mut input = bytes.as_slice();
        read_record(&mut input).unwrap();
        assert_eq!(
            read_record(&mut input).err().unwrap().kind(),
            std::io::ErrorKind::UnexpectedEof
        );
    }
}

fn read_elac(reader: &mut impl Read) -> Result<ElacData, Error> {
    Ok(ElacData {
        bus_outputs: read_bytes::<base_elac_out_bus>(reader)?,
        discrete_outputs: read_bytes::<base_elac_discrete_outputs>(reader)?,
        analog_outputs: read_bytes::<base_elac_analog_outputs>(reader)?,
    })
}

fn read_sec(reader: &mut impl Read) -> Result<SecData, Error> {
    Ok(SecData {
        bus_outputs: read_bytes::<base_sec_out_bus>(reader)?,
        discrete_outputs: read_bytes::<base_sec_discrete_outputs>(reader)?,
        analog_outputs: read_bytes::<base_sec_analog_outputs>(reader)?,
    })
}

fn read_fac(reader: &mut impl Read) -> Result<FacData, Error> {
    Ok(FacData {
        bus_outputs: read_bytes::<base_fac_bus>(reader)?,
        discrete_outputs: read_bytes::<base_fac_discrete_outputs>(reader)?,
        analog_outputs: read_bytes::<base_fac_analog_outputs>(reader)?,
    })
}
