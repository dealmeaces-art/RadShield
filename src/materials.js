// ============================================================================
// RadShield - Material Data Module
// Mass attenuation coefficients and buildup factor parameters
// Sources:
//   mu/rho, mu_en/rho: NIST XCOM database
//   GP buildup coefficients: ANSI/ANS-6.4.3-1991 Table 5.1 (exposure buildup,
//     transcribed from the standard and verified against its tabulated
//     Table 3 exposure buildup factors; air uses the energy-absorption set,
//     the only one published for air)
// Note (ANS-6.4.3 sec. 4.1): the standard's buildup factors were computed
// neglecting coherent scattering, so mfp for buildup lookup should strictly
// use mu-without-coherent (Table 1a). We currently use XCOM totals (with
// coherent) throughout; the difference is <1% above ~0.3 MeV and a few
// percent at very low energies - acceptable for now, refine if low-energy
// sources become important.
// ============================================================================

const Materials = (() => {

    // -----------------------------------------------------------------------
    // Mass attenuation coefficients (mu/rho) in cm²/g - TOTAL
    // Mass energy-absorption coefficients (mu_en/rho) in cm²/g
    // Data from NIST XCOM database
    // Energies in MeV
    // -----------------------------------------------------------------------

    // Energy grid (MeV) for interpolation
    const ENERGY_GRID = [
        0.01, 0.015, 0.02, 0.03, 0.04, 0.05, 0.06, 0.08,
        0.10, 0.15, 0.20, 0.30, 0.40, 0.50, 0.60, 0.80,
        1.00, 1.25, 1.50, 2.00, 3.00, 4.00, 5.00, 6.00,
        8.00, 10.0
    ];

    // Material definitions
    // Each material has:
    //   name, density (g/cm³), Z (effective atomic number),
    //   mu_rho: total mass attenuation coefficients at ENERGY_GRID points
    //   mu_en_rho: mass energy-absorption coefficients at ENERGY_GRID points
    //   buildup: GP buildup factor parameters at selected energies

    const MATERIAL_DATA = {
        lead: {
            name: "Lead",
            density: 11.35,  // g/cm³
            Z: 82,
            // Total mass attenuation coefficients (cm²/g) - NIST XCOM verified
            mu_rho: [
                130.6, 109.3, 86.36, 30.32, 14.36, 8.041, 4.027, 2.419,
                5.549, 2.014, 0.9985, 0.4038, 0.2318, 0.1614, 0.1248, 0.08870,
                0.07102, 0.05876, 0.05222, 0.04606, 0.04234, 0.04197, 0.04272, 0.04391,
                0.04675, 0.04972
            ],
            // Mass energy-absorption coefficients (cm²/g) - NIST XCOM verified
            mu_en_rho: [
                127.5, 104.7, 80.86, 26.14, 10.44, 6.740, 2.602, 1.436,
                4.275, 1.298, 0.5505, 0.1613, 0.07568, 0.09128, 0.06819, 0.04644,
                0.03654, 0.02988, 0.02640, 0.02360, 0.02322, 0.02449, 0.02600, 0.02744,
                0.02989, 0.03181
            ],
            // GP Exposure Buildup Factor coefficients
            // ANSI/ANS-6.4.3-1991 Table 5.1, "G-P Exposure Buildup Factor
            // Coefficients - Lead" (std p.89). Includes K-edge fine structure
            // (0.088/0.089 MeV discontinuity).
            // Verified against tabulated Table 3 exposure buildup factors:
            // B(1 MeV, 10 mfp) = 3.50 calc vs 3.51 table;
            // B(0.5 MeV, 10 mfp) = 2.09 calc vs 2.10 table.
            buildup: {
                0.03:  { b: 1.007, c: 0.322, a: 0.246, d: -0.1030, Xk: 13.67 },
                0.04:  { b: 1.014, c: 0.317, a: 0.245, d: -0.0867, Xk: 14.95 },
                0.05:  { b: 1.023, c: 0.312, a: 0.252, d: -0.1005, Xk: 14.17 },
                0.06:  { b: 1.033, c: 0.320, a: 0.260, d: -0.1223, Xk: 13.89 },
                0.08:  { b: 1.058, c: 0.362, a: 0.233, d: -0.1127, Xk: 13.91 },
                0.088: { b: 1.067, c: 0.382, a: 0.220, d: -0.1048, Xk: 14.14 },
                0.089: { b: 2.368, c: 1.580, a: 0.075, d: -0.0635, Xk: 12.44 },
                0.09:  { b: 2.187, c: 1.693, a: 0.050, d: -0.0415, Xk: 18.21 },
                0.10:  { b: 1.930, c: 1.499, a: 0.061, d: -0.1162, Xk: 29.65 },
                0.11:  { b: 1.821, c: 1.196, a: 0.102, d: -0.0756, Xk: 16.64 },
                0.12:  { b: 1.644, c: 0.970, a: 0.136, d: -0.1135, Xk: 16.10 },
                0.13:  { b: 1.540, c: 0.718, a: 0.194, d: -0.1685, Xk: 15.69 },
                0.14:  { b: 1.472, c: 0.479, a: 0.273, d: -0.2153, Xk: 16.50 },
                0.15:  { b: 1.402, c: 0.352, a: 0.269, d: -0.0247, Xk: 17.09 },
                0.16:  { b: 1.334, c: 0.329, a: 0.145, d: -0.0643, Xk: 11.38 },
                0.20:  { b: 1.201, c: 0.158, a: 0.426, d: -0.1873, Xk: 14.12 },
                0.30:  { b: 1.148, c: 0.422, a: 0.203, d: -0.1013, Xk: 13.49 },
                0.40:  { b: 1.187, c: 0.562, a: 0.137, d: -0.0706, Xk: 14.19 },
                0.50:  { b: 1.233, c: 0.634, a: 0.109, d: -0.0556, Xk: 14.20 },
                0.60:  { b: 1.269, c: 0.685, a: 0.089, d: -0.0440, Xk: 13.78 },
                0.80:  { b: 1.329, c: 0.759, a: 0.065, d: -0.0317, Xk: 13.69 },
                1.0:   { b: 1.367, c: 0.811, a: 0.051, d: -0.0283, Xk: 13.67 },
                1.5:   { b: 1.369, c: 0.942, a: 0.020, d: -0.0207, Xk: 14.65 },
                2.0:   { b: 1.384, c: 0.980, a: 0.014, d: -0.0216, Xk: 13.51 },
                3.0:   { b: 1.367, c: 1.006, a: 0.017, d: -0.0377, Xk: 13.33 },
                4.0:   { b: 1.337, c: 1.009, a: 0.024, d: -0.0455, Xk: 14.15 },
                5.0:   { b: 1.360, c: 0.957, a: 0.049, d: -0.0683, Xk: 14.04 },
                6.0:   { b: 1.363, c: 0.965, a: 0.054, d: -0.0716, Xk: 14.21 },
                8.0:   { b: 1.441, c: 0.994, a: 0.061, d: -0.0800, Xk: 14.18 },
                10.0:  { b: 1.464, c: 1.148, a: 0.032, d: -0.0554, Xk: 14.08 },
                15.0:  { b: 1.573, c: 1.337, a: 0.016, d: -0.0463, Xk: 13.54 },
            }
        },

        steel: {
            name: "Steel (Carbon Steel)",
            density: 7.874,  // g/cm³ (pure iron, close enough for carbon steel)
            Z: 26,
            // NIST XCOM verified - Iron (Z=26)
            mu_rho: [
                170.6, 57.08, 25.68, 8.176, 3.629, 1.958, 1.205, 0.5952,
                0.3717, 0.1964, 0.1460, 0.1099, 0.09400, 0.08414, 0.07704, 0.06699,
                0.05995, 0.05350, 0.04883, 0.04265, 0.03621, 0.03312, 0.03146, 0.03057,
                0.02991, 0.02994
            ],
            mu_en_rho: [
                136.9, 48.96, 22.60, 7.251, 3.155, 1.638, 0.9555, 0.4104,
                0.2177, 0.07961, 0.04825, 0.03361, 0.03039, 0.02914, 0.02836, 0.02714,
                0.02603, 0.02472, 0.02360, 0.02199, 0.02042, 0.01990, 0.01983, 0.01997,
                0.02050, 0.02108
            ],
            // GP Exposure Buildup Factor coefficients
            // ANSI/ANS-6.4.3-1991 Table 5.1, "G-P Exposure Buildup Factor
            // Coefficients - Iron" (std p.82). Iron data used for carbon steel.
            // Verified against tabulated Table 3 exposure buildup factors:
            // B(1 MeV, 10 mfp) = 15.7 calc vs 15.8 table;
            // B(0.5 MeV, 10 mfp) = 19.0 calc vs 19.1 table.
            buildup: {
                0.015: { b: 1.004, c: 1.561, a: -0.554, d: 0.3524, Xk: 5.60 },
                0.02:  { b: 1.012, c: 0.130, a: 0.620, d: -0.6162, Xk: 11.39 },
                0.03:  { b: 1.028, c: 0.374, a: 0.190, d: -0.3170, Xk: 29.34 },
                0.04:  { b: 1.058, c: 0.336, a: 0.248, d: -0.1188, Xk: 11.65 },
                0.05:  { b: 1.099, c: 0.366, a: 0.232, d: -0.1354, Xk: 14.01 },
                0.06:  { b: 1.148, c: 0.405, a: 0.208, d: -0.1142, Xk: 14.17 },
                0.08:  { b: 1.267, c: 0.470, a: 0.180, d: -0.0974, Xk: 14.48 },
                0.10:  { b: 1.389, c: 0.557, a: 0.144, d: -0.0791, Xk: 14.11 },
                0.15:  { b: 1.660, c: 0.743, a: 0.079, d: -0.0476, Xk: 14.12 },
                0.20:  { b: 1.839, c: 0.911, a: 0.034, d: -0.0334, Xk: 13.23 },
                0.30:  { b: 1.973, c: 1.095, a: -0.009, d: -0.0183, Xk: 11.86 },
                0.40:  { b: 1.992, c: 1.187, a: -0.027, d: -0.0140, Xk: 10.72 },
                0.50:  { b: 1.967, c: 1.240, a: -0.039, d: -0.0074, Xk: 8.34 },
                0.60:  { b: 1.947, c: 1.247, a: -0.040, d: -0.0096, Xk: 8.20 },
                0.80:  { b: 1.906, c: 1.233, a: -0.038, d: -0.0110, Xk: 7.93 },
                1.0:   { b: 1.841, c: 1.250, a: -0.048, d: 0.0140, Xk: 19.49 },
                1.5:   { b: 1.750, c: 1.197, a: -0.040, d: 0.0110, Xk: 15.90 },
                2.0:   { b: 1.712, c: 1.123, a: -0.021, d: -0.0057, Xk: 7.97 },
                3.0:   { b: 1.627, c: 1.059, a: -0.005, d: -0.0132, Xk: 11.99 },
                4.0:   { b: 1.553, c: 1.026, a: 0.005, d: -0.0191, Xk: 12.93 },
                5.0:   { b: 1.483, c: 1.009, a: 0.012, d: -0.0258, Xk: 13.12 },
                6.0:   { b: 1.442, c: 0.980, a: 0.023, d: -0.0355, Xk: 13.37 },
                8.0:   { b: 1.354, c: 0.974, a: 0.029, d: -0.0424, Xk: 13.65 },
                10.0:  { b: 1.297, c: 0.949, a: 0.042, d: -0.0561, Xk: 13.97 },
                15.0:  { b: 1.199, c: 0.957, a: 0.049, d: -0.0594, Xk: 14.37 },
            }
        },

        water: {
            name: "Water",
            density: 1.0,  // g/cm³
            Z: 7.42,  // effective Z
            mu_rho: [
                5.329, 1.673, 0.8096, 0.3756, 0.2683, 0.2269, 0.2059, 0.1837,
                0.1707, 0.1505, 0.1370, 0.1186, 0.1061, 0.09687, 0.08956, 0.07865,
                0.07066, 0.06323, 0.05754, 0.04942, 0.03969, 0.03403, 0.03031, 0.02771,
                0.02429, 0.02219
            ],
            // NIST XCOM verified
            mu_en_rho: [
                4.944, 1.374, 0.5503, 0.1557, 0.06947, 0.04223, 0.03190, 0.02597,
                0.02546, 0.02764, 0.02967, 0.03192, 0.03279, 0.03299, 0.03284, 0.03206,
                0.03103, 0.02965, 0.02833, 0.02608, 0.02281, 0.02066, 0.01915, 0.01806,
                0.01658, 0.01566
            ],
            // GP Exposure Buildup Factor coefficients
            // ANSI/ANS-6.4.3-1991 Table 5.1, "G-P Exposure Buildup Factor
            // Coefficients - Water" (std p.91).
            // Verified against tabulated Table 3 exposure buildup factors:
            // B(1 MeV, 10 mfp) = 26.4 calc vs 26.1 table;
            // B(1 MeV, 1 mfp) = 2.10 calc vs 2.08 table.
            buildup: {
                0.015: { b: 1.182, c: 0.463, a: 0.175, d: -0.0908, Xk: 14.23 },
                0.02:  { b: 1.427, c: 0.549, a: 0.143, d: -0.0707, Xk: 14.86 },
                0.03:  { b: 2.335, c: 0.736, a: 0.087, d: -0.0419, Xk: 13.28 },
                0.04:  { b: 3.477, c: 1.117, a: -0.019, d: 0.0026, Xk: 11.67 },
                0.05:  { b: 4.461, c: 1.457, a: -0.084, d: 0.0341, Xk: 13.62 },
                0.06:  { b: 4.983, c: 1.730, a: -0.126, d: 0.0561, Xk: 13.64 },
                0.08:  { b: 5.059, c: 2.059, a: -0.168, d: 0.0770, Xk: 13.67 },
                0.10:  { b: 4.663, c: 2.221, a: -0.186, d: 0.0826, Xk: 13.33 },
                0.15:  { b: 3.897, c: 2.242, a: -0.185, d: 0.0777, Xk: 14.19 },
                0.20:  { b: 3.478, c: 2.154, a: -0.176, d: 0.0774, Xk: 14.50 },
                0.30:  { b: 2.920, c: 2.022, a: -0.164, d: 0.0655, Xk: 14.21 },
                0.40:  { b: 2.660, c: 1.882, a: -0.149, d: 0.0595, Xk: 14.24 },
                0.50:  { b: 2.500, c: 1.766, a: -0.135, d: 0.0546, Xk: 14.33 },
                0.60:  { b: 2.377, c: 1.679, a: -0.124, d: 0.0503, Xk: 14.23 },
                0.80:  { b: 2.212, c: 1.544, a: -0.105, d: 0.0437, Xk: 14.36 },
                1.0:   { b: 2.103, c: 1.441, a: -0.089, d: 0.0378, Xk: 14.22 },
                1.5:   { b: 1.939, c: 1.269, a: -0.058, d: 0.0246, Xk: 14.52 },
                2.0:   { b: 1.839, c: 1.173, a: -0.039, d: 0.0161, Xk: 14.07 },
                3.0:   { b: 1.710, c: 1.056, a: -0.013, d: 0.0047, Xk: 11.82 },
                4.0:   { b: 1.621, c: 0.989, a: 0.004, d: -0.0041, Xk: 13.45 },
                5.0:   { b: 1.554, c: 0.939, a: 0.018, d: -0.0122, Xk: 13.55 },
                6.0:   { b: 1.507, c: 0.903, a: 0.029, d: -0.0272, Xk: 16.13 },
                8.0:   { b: 1.422, c: 0.879, a: 0.035, d: -0.0191, Xk: 13.36 },
                10.0:  { b: 1.362, c: 0.859, a: 0.042, d: -0.0247, Xk: 13.37 },
                15.0:  { b: 1.267, c: 0.843, a: 0.047, d: -0.0336, Xk: 15.08 },
            }
        },

        air: {
            name: "Air (Dry)",
            density: 0.001205,  // g/cm³ at STP
            Z: 7.36,  // effective Z
            mu_rho: [
                5.120, 1.614, 0.7779, 0.3538, 0.2485, 0.2080, 0.1875, 0.1662,
                0.1541, 0.1356, 0.1233, 0.1067, 0.09549, 0.08712, 0.08055, 0.07074,
                0.06358, 0.05687, 0.05175, 0.04447, 0.03581, 0.03079, 0.02751, 0.02522,
                0.02225, 0.02045
            ],
            // NIST XCOM verified
            mu_en_rho: [
                4.742, 1.334, 0.5389, 0.1537, 0.06833, 0.04098, 0.03041, 0.02407,
                0.02325, 0.02496, 0.02672, 0.02872, 0.02949, 0.02966, 0.02953, 0.02882,
                0.02789, 0.02666, 0.02547, 0.02345, 0.02057, 0.01870, 0.01740, 0.01647,
                0.01525, 0.01450
            ],
            // GP Buildup Factor coefficients for Air
            // ANSI/ANS-6.4.3-1991 Table 5.1, "G-P Energy Absorption Buildup
            // Factor Coefficients - Air" (std p.92). The 1991 standard does
            // NOT publish an exposure GP set for air; for low-Z media the two
            // sets differ by <~2% (compare the water tables), and air is never
            // the dominant buildup medium in this app, so the energy-absorption
            // set is used.
            buildup: {
                0.015: { b: 1.170, c: 0.459, a: 0.175, d: -0.0862, Xk: 13.73 },
                0.02:  { b: 1.407, c: 0.512, a: 0.161, d: -0.0819, Xk: 14.40 },
                0.03:  { b: 2.292, c: 0.693, a: 0.102, d: -0.0484, Xk: 13.34 },
                0.04:  { b: 3.390, c: 1.052, a: -0.004, d: -0.0068, Xk: 19.76 },
                0.05:  { b: 4.322, c: 1.383, a: -0.071, d: 0.0270, Xk: 13.51 },
                0.06:  { b: 4.837, c: 1.653, a: -0.115, d: 0.0511, Xk: 13.66 },
                0.08:  { b: 4.929, c: 1.983, a: -0.159, d: 0.0730, Xk: 13.74 },
                0.10:  { b: 4.580, c: 2.146, a: -0.178, d: 0.0759, Xk: 12.83 },
                0.15:  { b: 3.894, c: 2.148, a: -0.173, d: 0.0698, Xk: 14.46 },
                0.20:  { b: 3.345, c: 2.147, a: -0.176, d: 0.0719, Xk: 14.08 },
                0.30:  { b: 2.887, c: 1.990, a: -0.160, d: 0.0633, Xk: 14.13 },
                0.40:  { b: 2.635, c: 1.860, a: -0.146, d: 0.0583, Xk: 14.24 },
                0.50:  { b: 2.496, c: 1.736, a: -0.130, d: 0.0505, Xk: 14.32 },
                0.60:  { b: 2.371, c: 1.656, a: -0.120, d: 0.0472, Xk: 14.27 },
                0.80:  { b: 2.207, c: 1.532, a: -0.103, d: 0.0425, Xk: 14.12 },
                1.0:   { b: 2.102, c: 1.428, a: -0.086, d: 0.0344, Xk: 14.35 },
                1.5:   { b: 1.939, c: 1.265, a: -0.057, d: 0.0232, Xk: 14.24 },
                2.0:   { b: 1.835, c: 1.173, a: -0.039, d: 0.0161, Xk: 14.07 },
                3.0:   { b: 1.712, c: 1.051, a: -0.011, d: 0.0024, Xk: 13.67 },
                4.0:   { b: 1.627, c: 0.983, a: 0.006, d: -0.0051, Xk: 13.51 },
                5.0:   { b: 1.558, c: 0.943, a: 0.017, d: -0.0117, Xk: 13.82 },
                6.0:   { b: 1.505, c: 0.915, a: 0.025, d: -0.0231, Xk: 16.37 },
                8.0:   { b: 1.418, c: 0.891, a: 0.032, d: -0.0167, Xk: 12.06 },
                10.0:  { b: 1.358, c: 0.875, a: 0.037, d: -0.0226, Xk: 14.01 },
                15.0:  { b: 1.267, c: 0.844, a: 0.048, d: -0.0344, Xk: 14.55 },
            }
        },

        concrete: {
            name: "Concrete (Ordinary)",
            density: 2.30,  // g/cm³
            Z: 11.0,  // effective Z
            mu_rho: [
                26.23, 7.697, 3.405, 1.161, 0.5765, 0.3612, 0.2635, 0.1841,
                0.1541, 0.1275, 0.1153, 0.09963, 0.08930, 0.08159, 0.07553, 0.06647,
                0.05973, 0.05350, 0.04877, 0.04206, 0.03407, 0.02944, 0.02644, 0.02432,
                0.02163, 0.01998
            ],
            mu_en_rho: [
                24.43, 6.693, 2.712, 0.7260, 0.2752, 0.1366, 0.08350, 0.04382,
                0.03189, 0.02808, 0.02871, 0.02974, 0.03024, 0.03028, 0.02968, 0.02764,
                0.02549, 0.02307, 0.02104, 0.01797, 0.01420, 0.01197, 0.01054, 0.009538,
                0.008228, 0.007412
            ],
            // GP Exposure Buildup Factor coefficients
            // ANSI/ANS-6.4.3-1991 Table 5.1, "G-P Exposure Buildup Factor
            // Coefficients - Concrete" (std p.93).
            // Verified against tabulated Table 3 exposure buildup factors:
            // B(1 MeV, 10 mfp) = 20.7 calc vs 20.7 table;
            // B(0.5 MeV, 10 mfp) = 36.4 calc vs 36.4 table.
            buildup: {
                0.015: { b: 1.029, c: 0.364, a: 0.240, d: -0.1704, Xk: 14.12 },
                0.02:  { b: 1.067, c: 0.389, a: 0.214, d: -0.1126, Xk: 12.68 },
                0.03:  { b: 1.212, c: 0.421, a: 0.201, d: -0.1079, Xk: 14.12 },
                0.04:  { b: 1.455, c: 0.493, a: 0.171, d: -0.0925, Xk: 14.53 },
                0.05:  { b: 1.737, c: 0.628, a: 0.115, d: -0.0600, Xk: 15.82 },
                0.06:  { b: 2.125, c: 0.664, a: 0.118, d: -0.0615, Xk: 11.90 },
                0.08:  { b: 2.557, c: 0.895, a: 0.042, d: -0.0413, Xk: 14.37 },
                0.10:  { b: 2.766, c: 1.069, a: 0.001, d: -0.0251, Xk: 12.64 },
                0.15:  { b: 2.824, c: 1.315, a: -0.049, d: -0.0048, Xk: 8.66 },
                0.20:  { b: 2.716, c: 1.430, a: -0.070, d: 0.0108, Xk: 18.52 },
                0.30:  { b: 2.522, c: 1.492, a: -0.082, d: 0.0161, Xk: 16.59 },
                0.40:  { b: 2.372, c: 1.494, a: -0.085, d: 0.0194, Xk: 15.96 },
                0.50:  { b: 2.271, c: 1.466, a: -0.082, d: 0.0195, Xk: 16.25 },
                0.60:  { b: 2.192, c: 1.434, a: -0.078, d: 0.0199, Xk: 17.02 },
                0.80:  { b: 2.066, c: 1.386, a: -0.073, d: 0.0202, Xk: 15.07 },
                1.0:   { b: 1.982, c: 1.332, a: -0.065, d: 0.0193, Xk: 15.38 },
                1.5:   { b: 1.848, c: 1.227, a: -0.047, d: 0.0160, Xk: 16.41 },
                2.0:   { b: 1.775, c: 1.154, a: -0.033, d: 0.0100, Xk: 14.35 },
                3.0:   { b: 1.671, c: 1.054, a: -0.010, d: -0.0008, Xk: 10.47 },
                4.0:   { b: 1.597, c: 0.988, a: 0.008, d: -0.0115, Xk: 12.53 },
                5.0:   { b: 1.527, c: 0.951, a: 0.020, d: -0.0184, Xk: 9.99 },
                6.0:   { b: 1.478, c: 0.940, a: 0.021, d: -0.0163, Xk: 13.11 },
                8.0:   { b: 1.395, c: 0.917, a: 0.028, d: -0.0213, Xk: 13.45 },
                10.0:  { b: 1.334, c: 0.901, a: 0.035, d: -0.0267, Xk: 12.56 },
                15.0:  { b: 1.260, c: 0.823, a: 0.065, d: -0.0581, Xk: 14.28 },
            }
        }
    };

    // -----------------------------------------------------------------------
    // Soft Tissue (ICRU-44) mass energy-absorption coefficients (cm²/g)
    // NIST X-Ray Mass Attenuation Coefficients, "Soft Tissue (ICRU-44)";
    // table energies match ENERGY_GRID exactly (direct transcription).
    //
    // Dose-response medium ONLY: converts photon fluence to absorbed dose
    // in tissue, so the reported mrem/hr is tissue dose (QF=1 for photons),
    // not air kerma. Deliberately NOT in MATERIAL_DATA — tissue is not
    // selectable as a shield material and has no GP buildup set.
    // -----------------------------------------------------------------------
    const TISSUE_MU_EN_RHO = [
        4.987, 1.402, 0.5663, 0.1616, 0.07216, 0.04360, 0.03264, 0.02617,
        0.02545, 0.02745, 0.02942, 0.03164, 0.03249, 0.03269, 0.03254, 0.03176,
        0.03074, 0.02938, 0.02807, 0.02583, 0.02259, 0.02045, 0.01895, 0.01786,
        0.01639, 0.01547
    ];

    function getTissueMuEnRho(energy_MeV) {
        return logLogInterp(ENERGY_GRID, TISSUE_MU_EN_RHO, energy_MeV);
    }

    // -----------------------------------------------------------------------
    // Interpolation helper: log-log interpolation for attenuation coefficients
    // -----------------------------------------------------------------------
    function logLogInterp(energyGrid, values, energy) {
        if (energy <= energyGrid[0]) return values[0];
        if (energy >= energyGrid[energyGrid.length - 1]) return values[values.length - 1];

        // Find bracketing indices
        let i = 0;
        for (i = 0; i < energyGrid.length - 1; i++) {
            if (energy >= energyGrid[i] && energy <= energyGrid[i + 1]) break;
        }

        const logE = Math.log(energy);
        const logE0 = Math.log(energyGrid[i]);
        const logE1 = Math.log(energyGrid[i + 1]);
        const logV0 = Math.log(values[i]);
        const logV1 = Math.log(values[i + 1]);

        const t = (logE - logE0) / (logE1 - logE0);
        return Math.exp(logV0 + t * (logV1 - logV0));
    }

    // -----------------------------------------------------------------------
    // Get total mass attenuation coefficient (cm²/g)
    // -----------------------------------------------------------------------
    function getMuRho(materialKey, energy_MeV) {
        const mat = MATERIAL_DATA[materialKey];
        if (!mat) throw new Error(`Unknown material: ${materialKey}`);
        return logLogInterp(ENERGY_GRID, mat.mu_rho, energy_MeV);
    }

    // -----------------------------------------------------------------------
    // Get linear attenuation coefficient (cm⁻¹)
    // -----------------------------------------------------------------------
    function getMu(materialKey, energy_MeV) {
        const mat = MATERIAL_DATA[materialKey];
        return getMuRho(materialKey, energy_MeV) * mat.density;
    }

    // -----------------------------------------------------------------------
    // Get mass energy-absorption coefficient (cm²/g)
    // -----------------------------------------------------------------------
    function getMuEnRho(materialKey, energy_MeV) {
        const mat = MATERIAL_DATA[materialKey];
        if (!mat) throw new Error(`Unknown material: ${materialKey}`);
        return logLogInterp(ENERGY_GRID, mat.mu_en_rho, energy_MeV);
    }

    // -----------------------------------------------------------------------
    // GP Buildup Factor calculation
    // B(E, x) where x = total mean free paths (mu * t)
    // -----------------------------------------------------------------------
    function getBuildup(materialKey, energy_MeV, meanFreePaths) {
        const mat = MATERIAL_DATA[materialKey];
        if (!mat) throw new Error(`Unknown material: ${materialKey}`);

        const x = meanFreePaths;
        if (x <= 0) return 1.0;

        // Interpolate GP parameters for this energy
        const params = interpolateGPParams(mat.buildup, energy_MeV);
        const { b, c, a, d, Xk } = params;

        // Calculate K(x)
        const tanhTerm = (Math.tanh(x / Xk - 2) - Math.tanh(-2)) / (1 - Math.tanh(-2));
        const K = c * Math.pow(x, a) + d * tanhTerm;

        // Calculate B(x)
        if (Math.abs(K - 1) < 1e-6) {
            return 1 + (b - 1) * x;
        } else {
            return 1 + (b - 1) * (Math.pow(K, x) - 1) / (K - 1);
        }
    }

    // -----------------------------------------------------------------------
    // Interpolate GP buildup parameters for a given energy
    // Linear in ln(E), the conventional scheme for the ANS-6.4.3 energy grid
    // -----------------------------------------------------------------------
    function interpolateGPParams(buildupData, energy_MeV) {
        const energies = Object.keys(buildupData).map(Number).sort((a, b) => a - b);

        // Clamp to available range
        if (energy_MeV <= energies[0]) return buildupData[energies[0]];
        if (energy_MeV >= energies[energies.length - 1]) return buildupData[energies[energies.length - 1]];

        // Find bracketing energies
        let i = 0;
        for (i = 0; i < energies.length - 1; i++) {
            if (energy_MeV >= energies[i] && energy_MeV <= energies[i + 1]) break;
        }

        const E0 = energies[i];
        const E1 = energies[i + 1];
        const t = (Math.log(energy_MeV) - Math.log(E0)) / (Math.log(E1) - Math.log(E0));

        const p0 = buildupData[E0];
        const p1 = buildupData[E1];

        return {
            b:  p0.b  + t * (p1.b  - p0.b),
            c:  p0.c  + t * (p1.c  - p0.c),
            a:  p0.a  + t * (p1.a  - p0.a),
            d:  p0.d  + t * (p1.d  - p0.d),
            Xk: p0.Xk + t * (p1.Xk - p0.Xk),
        };
    }

    // -----------------------------------------------------------------------
    // Get material info
    // -----------------------------------------------------------------------
    function getMaterial(materialKey) {
        return MATERIAL_DATA[materialKey] || null;
    }

    function getMaterialList() {
        return Object.keys(MATERIAL_DATA).map(key => ({
            key: key,
            name: MATERIAL_DATA[key].name,
            density: MATERIAL_DATA[key].density
        }));
    }

    // -----------------------------------------------------------------------
    // Public API
    // -----------------------------------------------------------------------
    return {
        getMuRho,
        getMu,
        getMuEnRho,
        getTissueMuEnRho,
        getBuildup,
        getMaterial,
        getMaterialList,
        MATERIAL_DATA,
        ENERGY_GRID
    };

})();
