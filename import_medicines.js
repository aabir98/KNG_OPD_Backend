const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const csvData = `Serial,Name of medicine ,MRP
1,I MOON K2,320
2,NONI K2,792
3,AMYSTOP-G,200
4,HEMZE,117
5,CYSTY CIRCE,500
6,SENCID DSR,150
7,ZYRAB-DSR,112
8,DERMO CIRCE SOAP,110
9,SAMUDRI,380
10,ONION SHAMPOO,130
11,GRANTHI SANDHANAK,200
12,RELAXOPAIN,180
13,JOINT-X,399
14,MANDAKINI-2,425
15,KANCHANKAYA CHURNA,937
16,PIGO SAFE,456
17,ARILIV,400
18,BISWAS SF,240
19,GELCID,112
20,NEUROCARE SYP,470
21,V-CAN,900
22,ALKALIZING,1242
23,JEEVANIYA MAHAKSHAY,365
24,PAIN EXIT,649
25,ORTHO BOOSTER,549
26,LIV FORTE,173
27,AMLA JUICE,396
28,GREEN BALM,259
29,HOLD UP,205
30,OKRUSH,84
31,ISOTINE EYE DROP,130
32,RASRAJ KALP,1153
33,VISCOVAS,77
34,K-1 KFT,599
35,PARASUPP,305
36,HEMOTONIC,360
37,SHE CURE SYP,249
38,PROSTAWON,798
39,BEALKUT,166
40,MONTAN-BL,175
41,PUNARNABARIST,164
42,CARATOL-E,66
43,ASTHALEX CAP,590
44,URIFLOW,225
45,ZANDIABTS,202
46,JODDARAM,825
47,SNEZ CURE,113
48,ALLERGETIC,150
49,ASTHI SANDHANAK CAP,225
50,PAIN OUT,60
51,AIPRO,110
52,RUMAFLEX,510
53,YACCRUJJAY,185
54,PITTASEKHAR RAS,825
55,B-P DOWN,195
56,ISONEURON CAP,1599
57,RHEUMA-Q,285
58,RHEUMA-T,251
59,KINNAR KANTH RAS,612
60,COOLMELON,170
61,PSORONIL OIL,410
62,STREAM CP3,1385
63,AMYNITY PLUS,374
64,IMUNA K,165
65,LIFE LINE,1370
66,SUPERLAX POWDER,165
67,SWASMITRA AVALEHA,244
68,VATANTAK GOLD,825
69,TRAYADASHANG GUGGULU,235
70,TUMMY COOL ZYME,190
71,SUDDH MANAHSHILA,150
72,SWASNIKA,265
73,BRHAT ARBUDHARA RAS,737
74,AVIPATTIKAR CHURNA,198
75,ARSHORAJ CAP,126.55
76,RUTRELIEF CAP,599
77,KUKA ABALEHA,240
78,ENDSORA,200
79,TRAZYME/SENZYME,199
80,EKANGVEER RAS,210
81,IMOSA,350
82,PSORIATEC CAP,176
83,ARTHOZEN,275
84,LIVCARE TAB,399
85,LIVCARE SYP,181
86,ANTI DOTE,1299
87,ANTI FUNGAL GEL,155
88,ALSAHAR DS,650
89,LYCOPENE SYP,190
90,PERFECT HEALTH,276
91,TRIGLIZE,200
92,MULTI VITAMIN,243
93,ARTHEX,285
94,AYROVIN PLUS,160
95,CALID DS,120
96,ONION OIL,200
97,GRANTHI SANDHANAK,200
98,CYSTO BLESS,200
99,PILES CARE TAB,399
100,PSORINO CREAM,399`;

async function main() {
    const DATA_FILE = '/Users/macofdevil/Desktop/Kng_opd_total/KNG_OPD_Backend/data/medicines.json';
    
    // Read existing
    let existingMedicines = [];
    try {
        const content = await fs.readFile(DATA_FILE, 'utf-8');
        existingMedicines = JSON.parse(content);
    } catch(e) {
        // File might not exist
    }

    const lines = csvData.split('\n');
    const newMedicines = [];
    
    // Start from index 1 to skip header
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        
        const parts = line.split(',');
        if (parts.length >= 3) {
            const name = parts[1].trim();
            const price = parseFloat(parts[2].trim());
            
            // Check if already exists by name
            if (!existingMedicines.find(m => m.name.toLowerCase() === name.toLowerCase())) {
                newMedicines.push({
                    id: crypto.randomUUID(),
                    name: name,
                    price: price,
                    imageurl: '',
                    createdAt: new Date().toISOString()
                });
            }
        }
    }
    
    const combined = [...newMedicines, ...existingMedicines];
    
    await fs.writeFile(DATA_FILE, JSON.stringify(combined, null, 2), 'utf-8');
    console.log(`Successfully added ${newMedicines.length} new medicines from Google Sheet.`);
}

main().catch(console.error);
