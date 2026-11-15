// judge.level7: the seven steps 寒い … 暑い of a 肌感, against the six boundaries moved by a shift.
//   level = how many of (b_k + shift) the 肌感 has reached (0 = 寒い … 6 = 暑い)

import { defineFormula } from "../../estimate/engine";

export const level7 = defineFormula({
  id: "judge.level7",
  version: 1,
  key: "level7",
  label: "7段の判定",
  unit: "段",
  needs: ["feel", "shift"],
  choices: { feel: ["feelShade"], shift: ["seasonShift"] },
  params: ["b1", "b2", "b3", "b4", "b5", "b6"],
  compute: (x, p) => [p.b1, p.b2, p.b3, p.b4, p.b5, p.b6].filter((b) => x.feel >= b + x.shift).length,
});
