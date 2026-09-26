import * as THREE from 'three';
import { CCDIKSolver } from 'three/addons/animation/CCDIKSolver.js';

const LIMBS = {
  leftHand: ['leftUpperArm', 'leftLowerArm'],
  rightHand: ['rightUpperArm', 'rightLowerArm'],
  leftFoot: ['leftUpperLeg', 'leftLowerLeg'],
  rightFoot: ['rightUpperLeg', 'rightLowerLeg'],
};

export class LimbIK {
  constructor(joints, scene) {
    this.target = new THREE.Object3D();
    scene.add(this.target);
    this.chains = new Map();
    for (const [endId, [upperId, lowerId]] of Object.entries(LIMBS)) {
      const upper = joints[upperId];
      const lower = joints[lowerId];
      const end = joints[endId];
      if (!upper || !lower || !end) continue;
      const leg = endId.endsWith('Foot');
      const sign = endId.startsWith('left') ? -1 : 1;
      const rotationMin = new THREE.Vector3(0, 0, 0);
      const rotationMax = new THREE.Vector3(0, 0, 0);
      if (leg) rotationMax.x = 2.65;
      else if (sign < 0) rotationMin.y = -2.65;
      else rotationMax.y = 2.65;
      const config = {
        target: 3,
        effector: 0,
        links: [{ index: 1, rotationMin, rotationMax }, { index: 2 }],
        iteration: 80,
        maxAngle: 0.35,
      };
      const solver = new CCDIKSolver({ skeleton: { bones: [end, lower, upper, this.target] } }, [config]);
      this.chains.set(endId, { upper, lower, end, upperId, lowerId, leg, sign, solver });
    }
  }

  solve(id, position) {
    const chain = this.chains.get(id);
    if (!chain || !position.toArray().every(Number.isFinite)) return [];
    const { upper, lower, end, leg, sign, solver } = chain;
    upper.updateWorldMatrix(true, true);
    const rootPosition = upper.getWorldPosition(new THREE.Vector3());
    const bendPosition = lower.getWorldPosition(new THREE.Vector3());
    const endPosition = end.getWorldPosition(new THREE.Vector3());
    const endOrientation = end.getWorldQuaternion(new THREE.Quaternion());
    const upperLength = rootPosition.distanceTo(bendPosition);
    const lowerLength = bendPosition.distanceTo(endPosition);
    const targetPosition = position.clone();
    const offset = targetPosition.sub(rootPosition);
    const distance = offset.length();
    if (distance < 1e-6) offset.copy(endPosition).sub(rootPosition).normalize();
    else offset.divideScalar(distance);
    offset.multiplyScalar(THREE.MathUtils.clamp(distance, Math.abs(upperLength - lowerLength) + 0.005, (upperLength + lowerLength) * 0.995));
    this.target.position.copy(this.target.parent.worldToLocal(rootPosition.add(offset)));
    this.target.updateMatrixWorld(true);
    const bend = Math.max(0.08, Math.min(2.65, lower.quaternion.angleTo(new THREE.Quaternion())));
    lower.rotation.set(leg ? bend : 0, leg ? 0 : bend * sign, 0);
    lower.updateMatrixWorld(true);
    solver.update();
    const parentOrientation = end.parent.getWorldQuaternion(new THREE.Quaternion());
    end.quaternion.copy(parentOrientation.invert().multiply(endOrientation));
    end.updateMatrixWorld(true);
    return [chain.upperId, chain.lowerId, id];
  }

  dispose() {
    this.target.removeFromParent();
    this.chains.clear();
  }
}