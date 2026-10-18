use epoch::errors::EpochError;
use epoch::state::constants::RING_SIZE;

fn validate_initialize_batch_args(ring_index: u8, batch_id: u64) -> Result<(), EpochError> {
    if ring_index >= RING_SIZE {
        return Err(EpochError::InvalidSlotId);
    }
    let expected_ring_index = (batch_id % RING_SIZE as u64) as u8;
    if ring_index != expected_ring_index {
        return Err(EpochError::InvalidSlotId);
    }
    if batch_id != ring_index as u64 {
        return Err(EpochError::InvalidSlotId);
    }
    Ok(())
}

#[test]
fn test_initialize_batch_rejects_out_of_bounds_ring_index() {
    assert_eq!(
        validate_initialize_batch_args(8, 8).unwrap_err(),
        EpochError::InvalidSlotId
    );
    assert_eq!(
        validate_initialize_batch_args(255, 255).unwrap_err(),
        EpochError::InvalidSlotId
    );
}

#[test]
fn test_initialize_batch_rejects_mismatched_batch_id() {
    // batch_id 9 % 8 == 1, but ring_index is 2
    assert_eq!(
        validate_initialize_batch_args(2, 9).unwrap_err(),
        EpochError::InvalidSlotId
    );
}

#[test]
fn test_initialize_batch_rejects_arbitrary_future_batch_id_on_init() {
    // batch_id 16 % 8 == 0, but initial batch_id must be 0 for ring slot 0
    assert_eq!(
        validate_initialize_batch_args(0, 16).unwrap_err(),
        EpochError::InvalidSlotId
    );
}

#[test]
fn test_initialize_batch_valid_ring_slots_pass() {
    for r in 0..RING_SIZE {
        assert!(validate_initialize_batch_args(r, r as u64).is_ok());
    }
}
