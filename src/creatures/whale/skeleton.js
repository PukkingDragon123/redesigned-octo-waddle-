// The whale's skeleton: spine chain (root -> tail -> fluke, root -> chest -> neck -> head), jaw,
// brows (facial expression), fluke lobes, three-bone wings and the rear fins. Bone names are part
// of the game contract (Herd, physics and the animator address them).
import { Bone, Skeleton, Vector3 } from 'three';
import { wingDir } from './fins.js';

export function buildSkeleton(A) {
  const P = A.P, L = A.L;
  const abs = {};
  const bones = {};
  const list = [];
  const mk = (name, pos, parent) => {
    const b = new Bone();
    b.name = name;
    abs[name] = pos.clone();
    bones[name] = b;
    if (parent) {
      bones[parent].add(b);
      b.position.copy(pos).sub(abs[parent]);
    } else b.position.copy(pos);
    list.push(b);
    return b;
  };
  const spineP = (t) => { const pr = A.prof(t); return new Vector3(0, pr.cy, pr.z); };
  const J = P.joints;
  mk('root', spineP(J.root), null);
  mk('spine1', spineP(J.spine1), 'root');
  mk('spine2', spineP(J.spine2), 'spine1');
  mk('tail1', spineP(J.tail1), 'spine2');
  mk('tail2', spineP(J.tail2), 'tail1');
  mk('tail3', spineP(J.tail3), 'tail2');
  mk('fluke', spineP(0.0), 'tail3');
  const tail = A.prof(0.02);
  mk('flukeR', spineP(0.0).add(new Vector3(tail.hw * 1.2, 0, -0.01 * L)), 'fluke');
  mk('flukeL', spineP(0.0).add(new Vector3(-tail.hw * 1.2, 0, -0.01 * L)), 'fluke');
  mk('chest', spineP(J.chest), 'root');
  mk('neck', spineP(J.neck), 'chest');
  mk('head', spineP(J.head), 'neck');
  // jaw hinge at the gape's height
  const hp = A.prof(P.hinge);
  const th = A.cornerTheta(P.hinge);
  const xy = A.ringXY(hp, th);
  mk('jaw', new Vector3(0, xy[1] + hp.cy, hp.z), 'head');
  for (const side of [1, -1]) {
    const s = side > 0 ? 'R' : 'L';
    const e = P.eye;
    const br = A.spot(e.t + e.r * 0.9, e.m + 0.16, side);
    mk('brow' + s, br.p.clone().addScaledVector(br.n, -e.r * L * 1.5), 'head');
  }
  for (const side of [1, -1]) {
    const s = side > 0 ? 'R' : 'L';
    const W = P.wing;
    const sp = A.spot(W.t, W.m, side);
    const shoulder = sp.p.clone().addScaledVector(sp.n, -W.armR * L * 0.55);
    const dir = wingDir(side);
    const S = W.span * L * A.finScale;
    mk('fin' + s + '1', shoulder, 'chest');
    mk('fin' + s + '2', shoulder.clone().addScaledVector(dir, S * 0.38), 'fin' + s + '1');
    mk('fin' + s + '3', shoulder.clone().addScaledVector(dir, S * 0.72), 'fin' + s + '2');
    const R = P.rearFin;
    const rp = A.spot(R.t, R.m, side);
    mk('rear' + s, rp.p.clone().addScaledVector(rp.n, -R.armR * L * 0.4), 'spine2');
  }
  // world matrices must be current when the skeleton captures its inverse bind matrices
  bones.root.updateMatrixWorld(true);
  const skeleton = new Skeleton(list);
  const boneIndex = {};
  list.forEach((b, i) => (boneIndex[b.name] = i));
  return { bones, abs, list, skeleton, boneIndex };
}
