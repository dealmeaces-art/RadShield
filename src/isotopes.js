// ============================================================================
// RadShield - Isotope Data Module
// Gamma emission lines and nuclear data
// ============================================================================

const Isotopes = (() => {

    // -----------------------------------------------------------------------
    // Isotope database
    // Each isotope has:
    //   name: display name
    //   halfLife: { value, unit }
    //   gammaLines: [{ energy_MeV, yield (fraction per disintegration) }]
    //   specificGammaConstant: R·m²/(Ci·hr) at 1 meter (for verification)
    // -----------------------------------------------------------------------

    const ISOTOPE_DATA = {
        'Co-60': {
            name: 'Cobalt-60',
            halfLife: { value: 5.2714, unit: 'years' },
            gammaLines: [
                { energy_MeV: 1.1732, yield: 0.9985 },
                { energy_MeV: 1.3325, yield: 0.9998 }
            ],
            specificGammaConstant: 1.30  // R·m²/(Ci·hr) - for verification
        },
        'Cs-137': {
            name: 'Cesium-137',
            halfLife: { value: 30.17, unit: 'years' },
            gammaLines: [
                { energy_MeV: 0.6617, yield: 0.8510 }
            ],
            specificGammaConstant: 0.33
        },
        'Ir-192': {
            name: 'Iridium-192',
            halfLife: { value: 73.827, unit: 'days' },
            gammaLines: [
                { energy_MeV: 0.2058, yield: 0.0334 },
                { energy_MeV: 0.2962, yield: 0.2872 },
                { energy_MeV: 0.3085, yield: 0.2970 },
                { energy_MeV: 0.3165, yield: 0.8271 },
                { energy_MeV: 0.4685, yield: 0.4784 },
                { energy_MeV: 0.6045, yield: 0.0823 },
                { energy_MeV: 0.6126, yield: 0.0534 }
            ],
            specificGammaConstant: 0.48
        },
        'I-131': {
            name: 'Iodine-131',
            halfLife: { value: 8.0197, unit: 'days' },
            gammaLines: [
                { energy_MeV: 0.3645, yield: 0.8120 },
                { energy_MeV: 0.6370, yield: 0.0717 },
                { energy_MeV: 0.2843, yield: 0.0614 }
            ],
            specificGammaConstant: 0.22
        },
        'Na-24': {
            name: 'Sodium-24',
            halfLife: { value: 14.997, unit: 'hours' },
            gammaLines: [
                { energy_MeV: 1.3686, yield: 0.9999 },
                { energy_MeV: 2.7541, yield: 0.9986 }
            ],
            specificGammaConstant: 1.84
        }
    };

    // -----------------------------------------------------------------------
    // Get isotope data
    // -----------------------------------------------------------------------
    function getIsotope(isotopeKey) {
        return ISOTOPE_DATA[isotopeKey] || null;
    }

    function getIsotopeList() {
        return Object.keys(ISOTOPE_DATA).map(key => ({
            key: key,
            name: ISOTOPE_DATA[key].name,
            halfLife: ISOTOPE_DATA[key].halfLife
        }));
    }

    // -----------------------------------------------------------------------
    // Calculate activity from initial activity and elapsed time
    // -----------------------------------------------------------------------
    function decayActivity(initialActivity_Ci, halfLife_seconds, elapsedTime_seconds) {
        return initialActivity_Ci * Math.pow(2, -elapsedTime_seconds / halfLife_seconds);
    }

    // Convert half-life to seconds
    function halfLifeToSeconds(halfLife) {
        const multipliers = {
            'seconds': 1,
            'minutes': 60,
            'hours': 3600,
            'days': 86400,
            'years': 365.25 * 86400
        };
        return halfLife.value * (multipliers[halfLife.unit] || 1);
    }

    // -----------------------------------------------------------------------
    // Public API
    // -----------------------------------------------------------------------
    return {
        getIsotope,
        getIsotopeList,
        decayActivity,
        halfLifeToSeconds,
        ISOTOPE_DATA
    };

})();
