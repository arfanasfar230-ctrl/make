import * as THREE from 'three';
import type { SceneContext, InteractiveObject, ErgonomicsResult, ErgonomicsParameter, PlayerState } from './types';

const ERGONOMIC_RANGES: Record<string, {
  idealMinDist: number;
  idealMaxDist: number;
  minDist: number;
  maxDist: number;
  idealHeightRatio: [number, number];
}> = {
  counter: {
    idealMinDist: 0.15,
    idealMaxDist: 0.55,
    minDist: 0.05,
    maxDist: 1.0,
    idealHeightRatio: [0.40, 0.55],
  },
  stove: {
    idealMinDist: 0.25,
    idealMaxDist: 0.65,
    minDist: 0.10,
    maxDist: 1.2,
    idealHeightRatio: [0.38, 0.52],
  },
  sink: {
    idealMinDist: 0.15,
    idealMaxDist: 0.55,
    minDist: 0.05,
    maxDist: 1.0,
    idealHeightRatio: [0.38, 0.50],
  },
  fridge: {
    idealMinDist: 0.30,
    idealMaxDist: 0.80,
    minDist: 0.15,
    maxDist: 1.5,
    idealHeightRatio: [0.0, 1.0],
  },
  cabinet: {
    idealMinDist: 0.20,
    idealMaxDist: 0.60,
    minDist: 0.10,
    maxDist: 1.2,
    idealHeightRatio: [0.50, 0.90],
  },
  prep_area: {
    idealMinDist: 0.15,
    idealMaxDist: 0.50,
    minDist: 0.05,
    maxDist: 1.0,
    idealHeightRatio: [0.40, 0.55],
  },
  other: {
    idealMinDist: 0.20,
    idealMaxDist: 0.60,
    minDist: 0.10,
    maxDist: 1.2,
    idealHeightRatio: [0.35, 0.60],
  },
};

const INTERACTION_RANGE_M = 2.0;

export class ErgonomicsSystem {
  private ctx: SceneContext;
  private nearestObject: InteractiveObject | null = null;
  private modelUnitsPerMeter: number;

  constructor(ctx: SceneContext) {
    this.ctx = ctx;
    this.modelUnitsPerMeter = ctx.sceneScale;
  }

  private getRanges(category: string): typeof ERGONOMIC_RANGES.counter {
    return ERGONOMIC_RANGES[category] || ERGONOMIC_RANGES.other;
  }

  public findNearestObject(playerPos: THREE.Vector3): InteractiveObject | null {
    let nearest: InteractiveObject | null = null;
    let nearestDist = Infinity;
    const range = INTERACTION_RANGE_M * this.modelUnitsPerMeter;

    for (const obj of this.ctx.interactiveObjects) {
      const dist = this.distanceToObjectXY(playerPos, obj);
      if (dist < nearestDist && dist < range) {
        nearestDist = dist;
        nearest = obj;
      }
    }

    this.nearestObject = nearest;
    return nearest;
  }

  public getNearestObject(): InteractiveObject | null {
    return this.nearestObject;
  }

  public analyze(playerState: PlayerState, obj: InteractiveObject): ErgonomicsResult {
    const scale = this.modelUnitsPerMeter;

    const playerPos = playerState.position.clone();
    playerPos.y = this.ctx.floorY;

    const objCenterXZ = new THREE.Vector3(obj.center.x, this.ctx.floorY, obj.center.z);
    const distM = this.distanceToObjectXY(playerPos, obj) / scale;
    const objHeightM = obj.height / scale;
    const surfaceHeightM = (obj.surfaceY - this.ctx.floorY) / scale;
    const playerHeightM = playerState.height / scale;

    const params: ErgonomicsParameter[] = [];
    const ranges = this.getRanges(obj.category);

    const distScore = this.calculateDistanceScore(distM, ranges);
    params.push({
      name: 'Jarak ke Objek',
      value: distScore,
      maxValue: 100,
      weight: 0.30,
      description: this.getDistDescription(distM, ranges),
    });

    const heightScore = this.calculateHeightScore(playerHeightM, surfaceHeightM, obj.category);
    params.push({
      name: 'Tinggi Relatif',
      value: heightScore,
      maxValue: 100,
      weight: 0.20,
      description: this.getHeightDescription(playerHeightM, surfaceHeightM, obj.category),
    });

    const toObj = new THREE.Vector3()
      .set(objCenterXZ.x - playerPos.x, 0, objCenterXZ.z - playerPos.z)
      .normalize();
    const alignment = this.facingAlignment(playerState, toObj);
    const postureScore = this.calculatePostureScore(distM, alignment, obj.category);
    params.push({
      name: 'Postur Kerja',
      value: postureScore,
      maxValue: 100,
      weight: 0.25,
      description: this.getPostureDescription(distM, obj.category),
    });

    const reachScore = this.calculateReachScore(distM, playerHeightM, surfaceHeightM);
    params.push({
      name: 'Jangkauan Kerja',
      value: reachScore,
      maxValue: 100,
      weight: 0.15,
      description: this.getReachDescription(distM, reachScore, scale),
    });

    const safetyScore = this.calculateSafetyScore(distM, obj.category);
    params.push({
      name: 'Keamanan',
      value: safetyScore,
      maxValue: 100,
      weight: 0.10,
      description: this.getSafetyDescription(distM, obj.category),
    });

    let totalScore = 0;
    let totalWeight = 0;
    for (const p of params) {
      totalScore += p.value * p.weight;
      totalWeight += p.weight;
    }
    const finalScore = totalWeight > 0 ? Math.round(totalScore / totalWeight) : 0;

    const recommendations = this.generateRecommendations(playerState, obj, distM, params, scale);

    let status: 'Baik' | 'Cukup' | 'Kurang';
    let statusClass: string;
    if (finalScore >= 70) {
      status = 'Baik';
      statusClass = 'ergo-baik';
    } else if (finalScore >= 40) {
      status = 'Cukup';
      statusClass = 'ergo-cukup';
    } else {
      status = 'Kurang';
      statusClass = 'ergo-kurang';
    }

    return {
      score: finalScore,
      status,
      statusClass,
      parameters: params,
      recommendations,
    };
  }

  private calculateDistanceScore(distM: number, ranges: typeof ERGONOMIC_RANGES.counter): number {
    if (distM >= ranges.idealMinDist && distM <= ranges.idealMaxDist) {
      return 100;
    }
    if (distM < ranges.minDist) {
      return 15;
    }
    if (distM > ranges.maxDist) {
      return 10;
    }
    if (distM < ranges.idealMinDist) {
      const t = (distM - ranges.minDist) / (ranges.idealMinDist - ranges.minDist);
      return Math.round(15 + t * 85);
    }
    const t = (distM - ranges.idealMaxDist) / (ranges.maxDist - ranges.idealMaxDist);
    return Math.round(100 - t * 60);
  }

  private calculateHeightScore(
    playerHeightM: number,
    surfaceHeightM: number,
    category: string
  ): number {
    const ranges = this.getRanges(category);
    const ratio = playerHeightM > 0 ? surfaceHeightM / playerHeightM : 0;

    if (ratio >= ranges.idealHeightRatio[0] && ratio <= ranges.idealHeightRatio[1]) {
      return 100;
    }

    const midpoint = (ranges.idealHeightRatio[0] + ranges.idealHeightRatio[1]) / 2;
    const dev = Math.abs(ratio - midpoint);
    const maxDev = 0.3;
    return Math.max(20, Math.round(100 * (1 - dev / maxDev)));
  }

  private calculatePostureScore(
    distM: number,
    alignment: number,
    category: string
  ): number {
    let score = 50;

    if (distM >= 0.3 && distM <= 0.7) {
      score += 30;
    } else if (distM < 0.3) {
      score += 10;
    } else if (distM <= 1.0) {
      score += 15;
    } else {
      score -= 20;
    }

    const absAlignment = Math.abs(alignment);
    if (absAlignment > 0.7) {
      score += 20;
    } else if (absAlignment > 0.3) {
      score += 10;
    } else {
      score += 5;
    }

    if (category === 'fridge' && distM < 0.3) {
      score -= 25;
    }
    if (category === 'counter' && distM >= 0.2 && distM <= 0.6) {
      score += 10;
    }

    return Math.max(0, Math.min(100, score));
  }

  private calculateReachScore(distM: number, playerHeightM: number, surfaceHeightM: number): number {
    const shoulderHeightM = playerHeightM * 0.8;
    const armReachM = playerHeightM * 0.4;
    const optimalReachM = armReachM * 0.6;

    const verticalDiffM = Math.abs(surfaceHeightM - shoulderHeightM);

    let base = 100;
    const verticalPenalty = verticalDiffM > 0.15 ? Math.min(30, (verticalDiffM - 0.15) * 100) : 0;

    if (distM <= optimalReachM) {
      base -= verticalPenalty * 0.5;
    } else if (distM <= armReachM) {
      const t = (distM - optimalReachM) / (armReachM - optimalReachM);
      base -= t * 40 + verticalPenalty * 0.5;
    } else if (distM <= armReachM * 1.5) {
      const t = (distM - armReachM) / (armReachM * 0.5);
      base -= 40 + t * 40 + verticalPenalty;
    } else {
      base = 15;
    }

    return Math.max(5, Math.min(100, Math.round(base)));
  }

  private calculateSafetyScore(distM: number, category: string): number {
    let baseScore = 80;

    if (category === 'stove') {
      if (distM < 0.2) baseScore = 20;
      else if (distM < 0.4) baseScore = 50;
      else if (distM < 1.0) baseScore = 90;
      else baseScore = 75;
    } else if (category === 'sink') {
      if (distM < 0.15) baseScore = 60;
      else if (distM < 0.5) baseScore = 95;
      else baseScore = 80;
    } else if (category === 'fridge') {
      if (distM < 0.3) baseScore = 70;
      else if (distM < 0.8) baseScore = 95;
      else baseScore = 80;
    } else {
      if (distM < 0.2) baseScore = 65;
      else if (distM < 0.8) baseScore = 90;
      else baseScore = 75;
    }

    return baseScore;
  }

  private getDistDescription(distM: number, ranges: typeof ERGONOMIC_RANGES.counter): string {
    const distLabel = distM.toFixed(2) + 'm';
    if (distM < ranges.minDist) return `Terlalu dekat (${distLabel}) - berisiko terluka`;
    if (distM >= ranges.idealMinDist && distM <= ranges.idealMaxDist) return `Jarak ideal (${distLabel})`;
    if (distM > ranges.maxDist) return `Terlalu jauh (${distLabel}) - sulit dijangkau`;
    if (distM < ranges.idealMinDist) return `Sedikit terlalu dekat (${distLabel})`;
    return `Sedikit terlalu jauh (${distLabel})`;
  }

  private getHeightDescription(playerHeightM: number, surfaceHeightM: number, category: string): string {
    const ranges = this.getRanges(category);
    const ratio = playerHeightM > 0 ? surfaceHeightM / playerHeightM : 0;
    const idealMin = ranges.idealHeightRatio[0];
    const idealMax = ranges.idealHeightRatio[1];

    if (ratio >= idealMin && ratio <= idealMax) return `Tinggi permukaan proporsional (${(ratio * 100).toFixed(0)}% dari tinggi badan)`;
    if (ratio < idealMin) return `Permukaan terlalu rendah (${(ratio * 100).toFixed(0)}%) - perlu membungkuk`;
    return `Permukaan terlalu tinggi (${(ratio * 100).toFixed(0)}%) - sulit dijangkau`;
  }

  private getPostureDescription(distM: number, category: string): string {
    if (category === 'fridge') {
      if (distM < 0.3) return 'Terlalu dekat - perlu condong ke belakang';
      if (distM >= 0.3 && distM <= 0.7) return 'Kesulitan membuka pintu kulkas';
      if (distM <= 1.0) return 'Posisi cukup untuk membuka pintu';
      return 'Terlalu jauh - menarik tubuh berlebihan';
    }
    if (distM >= 0.3 && distM <= 0.7) return 'Posisi berdiri nyaman untuk bekerja';
    if (distM < 0.3) return 'Terlalu dekat - postur terganggu';
    if (distM > 1.0) return 'Terlalu jauh - perlu mencondongkan tubuh';
    return 'Posisi cukup, bisa lebih optimal';
  }

  private getReachDescription(distM: number, score: number, scale: number): string {
    if (score >= 80) return 'Dalam jangkauan optimal';
    if (score >= 50) return 'Masih dapat dijangkau dengan sedikit peregangan';
    return 'Di luar jangkauan nyaman';
  }

  private getSafetyDescription(distM: number, category: string): string {
    if (category === 'stove') {
      if (distM < 0.3) return 'Terlalu dekat dengan kompor - bahaya panas';
      if (distM < 0.5) return 'Jarak aman dari kompor';
      return 'Jarak aman';
    }
    if (distM < 0.2) return 'Sangat dekat - hati-hati';
    return 'Jarak aman';
  }

  private generateRecommendations(
    playerState: PlayerState,
    obj: InteractiveObject,
    distM: number,
    params: ErgonomicsParameter[],
    scale: number
  ): string[] {
    const recs: string[] = [];
    const ranges = this.getRanges(obj.category);

    if (distM < ranges.idealMinDist) {
      const recDist = (ranges.idealMinDist + ranges.idealMaxDist) / 2;
      recs.push(`Mundur sedikit, posisikan diri ${recDist.toFixed(2)}m dari objek`);
    } else if (distM > ranges.idealMaxDist) {
      const recDist = (ranges.idealMinDist + ranges.idealMaxDist) / 2;
      recs.push(`Mendekat, posisikan diri ${recDist.toFixed(2)}m dari objek`);
    }

    const heightParam = params.find(p => p.name === 'Tinggi Relatif');
    if (heightParam && heightParam.value < 60) {
      const surfaceHeightM = (obj.surfaceY - this.ctx.floorY) / scale;
      const playerHeightM = playerState.height / scale;
      const ratio = playerHeightM > 0 ? surfaceHeightM / playerHeightM : 0;
      if (ratio > 0.65) {
        recs.push('Pertimbangkan penggunaan bangku atau alas kaki');
      } else if (ratio < 0.35) {
        recs.push('Permukaan terlalu rendah, perhatikan postur punggung');
      }
    }

    const postureParam = params.find(p => p.name === 'Postur Kerja');
    if (postureParam && postureParam.value < 50) {
      recs.push('Hadap langsung ke objek untuk postur lebih baik');
    }

    if (obj.category === 'stove' && distM < 0.3) {
      recs.push('Jaga jarak aman dari kompor untuk menghindari luka bakar');
    }

    if (obj.category === 'sink' && distM > 0.6) {
      recs.push('Mendekat ke wastafel untuk mengurangi tekanan punggung');
    }

    if (obj.category === 'fridge' && distM < 0.3) {
      recs.push('Jaga jarak agar pintu kulkas dapat terbuka dengan leluasa');
    }

    if (recs.length === 0) {
      recs.push('Posisi Anda sudah cukup ergonomis untuk objek ini');
    }

    return recs;
  }

  /**
   * How well the player is facing the object. 1 = directly facing, -1 = turned
   * away. Uses the player's actual yaw (shared state for Desktop/Mobile/VR).
   */
  private facingAlignment(playerState: PlayerState, toObj: THREE.Vector3): number {
    const forward = new THREE.Vector3(
      -Math.sin(playerState.yaw),
      0,
      -Math.cos(playerState.yaw)
    ).normalize();
    return forward.dot(toObj);
  }

  /**
   * Distance (in model units) from a player XZ-position to the closest point on
   * the object's bounding box. Prevents a long counter from being treated as
   * "far away" just because the player stands at one end.
   */
  private distanceToObjectXY(playerPos: THREE.Vector3, obj: InteractiveObject): number {
    const b = obj.boundingBox;
    const cx = THREE.MathUtils.clamp(playerPos.x, b.min.x, b.max.x);
    const cz = THREE.MathUtils.clamp(playerPos.z, b.min.z, b.max.z);
    const dx = playerPos.x - cx;
    const dz = playerPos.z - cz;
    return Math.sqrt(dx * dx + dz * dz);
  }

  public getInteractionRange(): number {
    return INTERACTION_RANGE_M;
  }
}