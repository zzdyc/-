import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import * as THREE from 'three';

// --- MODULE: IdleWowFacade (Types & Models) ---
type StatType = 'str' | 'agi' | 'int' | 'sta';
type ItemQuality = 'poor' | 'common' | 'rare' | 'epic';
type ItemSlot = 'weapon' | 'head' | 'chest' | 'legs';
type PlayerClass = 'novice' | 'warrior' | 'mage';
type SkillId = 'heroic_strike' | 'mortal_strike' | 'execute' | 'fireball' | 'frostbolt' | 'arcane_blast';
type AutoAllocStrategy = 'manual' | 'str' | 'agi' | 'int' | 'sta' | 'str_agi' | 'int_sta';

interface Item {
  id: string;
  name: string;
  slot: ItemSlot;
  quality: ItemQuality;
  stats: Partial<Record<StatType, number>>;
  value: number; // in copper
  reqLevel: number;
  score: number; // New: Gear Score
}

interface MobTemplate {
  id: string;
  name: string;
  level: number;
  baseHp: number;
  minDmg: number;
  maxDmg: number;
  xpGiven: number;
  modelType: 'humanoid' | 'beast' | 'mech' | 'dragon' | 'undead' | 'demon' | 'elemental';
  color: number;
  isBoss?: boolean;
}

interface Zone {
  id: string;
  name: string;
  minLevel: number;
  maxLevel: number;
  mobs: MobTemplate[];
}

interface SkillDef {
  id: SkillId;
  name: string;
  description: string;
  cost: number; // Rage amount or Mana percentage
  costType: 'rage' | 'mana';
  cooldown: number; // ms
  minLevel: number;
  reqClass: PlayerClass;
  dmgMult: number; // Base Damage multiplier
}

interface MartialArt {
    id: string;
    name: string;
    desc: string;
    cost: number; // Six Paths Power
    stats: Partial<Record<StatType, number>>;
    quality: 'rare' | 'epic' | 'legendary';
}

interface PlayerStats {
  username: string;
  class: PlayerClass;
  // Stats
  str: number; agi: number; int: number; sta: number;
  attributePoints: number; // New: Free points to spend
  autoAllocMode: AutoAllocStrategy; // New: Auto allocation preference
  // Vitals
  hp: number; maxHp: number;
  mana: number; maxMana: number;
  rage: number; // 0-100
  // Progression
  xp: number; maxXp: number;
  level: number;
  skillPoints: number;
  skills: Partial<Record<SkillId, number>>; // Skill ID -> Rank
  mobsKilled: number; // New: Tracking for tutorial/stats
  // Economy
  gold: number;
  potions: number;
  // Meta
  godModeEnabled?: boolean;
  godModeAutoEquip?: boolean; // New: Auto equip/sell
  gameSpeed?: number;
  modelOverride?: string; // For God Mode
  // Reincarnation System
  reincarnationUnlocked?: boolean;
  reincarnationPower: number; // +1 per death
  sixPathsPower: number; // Converted from 10 Reincarnation Power
  furyEnabled?: boolean; // Double stats for one fight
  passiveArts: string[]; // Owned Martial Arts IDs
}

interface LogEntry {
  id: string;
  text: string;
  type: 'dmg' | 'heal' | 'loot' | 'sys' | 'skill';
  timestamp: number;
}

// --- LOCALIZATION & CONSTANTS ---
const QUALITY_CN: Record<ItemQuality, string> = {
  poor: '粗糙',
  common: '普通',
  rare: '稀有',
  epic: '史诗'
};

const SLOT_CN: Record<ItemSlot, string> = {
  weapon: '武器',
  head: '头部',
  chest: '胸甲',
  legs: '腿部'
};

const AUTO_ALLOC_CN: Record<AutoAllocStrategy, string> = {
  manual: '手动分配',
  str: '狂战士 (全力量)',
  agi: '刺客 (全敏捷)',
  int: '大法师 (全智力)',
  sta: '守护者 (全耐力)',
  str_agi: '决斗者 (力/敏交替)',
  int_sta: '术士 (智/耐交替)'
};

const SKILL_DB: Record<SkillId, SkillDef> = {
  heroic_strike: { id: 'heroic_strike', name: '英勇打击', description: '消耗怒气造成武器伤害', cost: 15, costType: 'rage', cooldown: 3000, minLevel: 10, reqClass: 'warrior', dmgMult: 1.2 },
  mortal_strike: { id: 'mortal_strike', name: '致死打击', description: '强力的一击', cost: 30, costType: 'rage', cooldown: 6000, minLevel: 10, reqClass: 'warrior', dmgMult: 1.5 },
  execute: { id: 'execute', name: '斩杀', description: '尝试终结敌人 (仅生命值<20%可用)', cost: 40, costType: 'rage', cooldown: 1000, minLevel: 10, reqClass: 'warrior', dmgMult: 3.0 },
  fireball: { id: 'fireball', name: '火球术', description: '造成火焰伤害', cost: 10, costType: 'mana', cooldown: 3000, minLevel: 10, reqClass: 'mage', dmgMult: 1.3 },
  frostbolt: { id: 'frostbolt', name: '寒冰箭', description: '造成伤害并减缓敌人攻击速度', cost: 10, costType: 'mana', cooldown: 4000, minLevel: 10, reqClass: 'mage', dmgMult: 1.0 },
  arcane_blast: { id: 'arcane_blast', name: '奥术冲击', description: '消耗大量法力造成巨额伤害', cost: 30, costType: 'mana', cooldown: 8000, minLevel: 10, reqClass: 'mage', dmgMult: 2.0 },
};

const MARTIAL_ARTS_DB: MartialArt[] = [
    { id: 'art_1', name: '易筋经', desc: '少林绝学，强身健体。', cost: 1, stats: { str: 5, sta: 5, agi: 5, int: 5 }, quality: 'rare' },
    { id: 'art_2', name: '洗髓经', desc: '伐毛洗髓，脱胎换骨。', cost: 5, stats: { str: 20, sta: 20 }, quality: 'rare' },
    { id: 'art_3', name: '九阳神功', desc: '至刚至阳，内力生生不息。', cost: 10, stats: { str: 50, sta: 50, int: 20 }, quality: 'epic' },
    { id: 'art_4', name: '九阴真经', desc: '道家极品，包罗万象。', cost: 10, stats: { agi: 50, int: 50, str: 20 }, quality: 'epic' },
    { id: 'art_5', name: '太玄经', desc: '侠客岛绝学，深不可测。', cost: 50, stats: { str: 200, agi: 200, int: 200, sta: 200 }, quality: 'legendary' },
];

// --- ICONS ---
const ICONS = {
  weapon: (
    <svg viewBox="0 0 24 24" fill="currentColor" width="24px" height="24px">
      <path d="M7 21l-4-4 2-2 4 4v-4l9-9 4 4-9 9h-4L7 21zM19.5 5.5l-2-2 1.5-1.5 2 2-1.5 1.5z"/>
    </svg>
  ),
  head: (
    <svg viewBox="0 0 24 24" fill="currentColor" width="24px" height="24px">
      <path d="M12 2c-4.42 0-8 3.58-8 8v4h2v6h12v-6h2v-4c0-4.42-3.58-8-8-8zm0 2c3.31 0 6 2.69 6 6v2H6v-2c0-3.31 2.69-6 6-6z"/>
    </svg>
  ),
  chest: (
    <svg viewBox="0 0 24 24" fill="currentColor" width="24px" height="24px">
      <path d="M12 2L4 5v6c0 5.55 3.84 10.74 8 12 4.16-1.26 8-6.45 8-12V5l-8-3z"/>
    </svg>
  ),
  legs: (
    <svg viewBox="0 0 24 24" fill="currentColor" width="24px" height="24px">
      <path d="M19 5H5v14h4v-7h6v7h4V5z"/>
    </svg>
  )
};

// --- MODULE: IdleWowAudio (Procedural Audio Engine) ---
class IdleWowAudio {
  static ctx: AudioContext | null = null;
  static masterGain: GainNode | null = null;
  static isMuted: boolean = false;
  static bgmOscillators: OscillatorNode[] = [];
  static bgmGain: GainNode | null = null;
  static currentZoneId: string = '';
  static bgmInterval: any = null;

  static init() {
    if (this.ctx) return;
    try {
        const AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext;
        this.ctx = new AudioContext();
        this.masterGain = this.ctx!.createGain();
        this.masterGain.connect(this.ctx!.destination);
        this.masterGain.gain.value = 0.3;
    } catch (e) {
        console.warn("AudioContext init failed", e);
    }
  }

  static toggleMute() {
    this.isMuted = !this.isMuted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(this.isMuted ? 0 : 0.3, this.ctx.currentTime, 0.1);
    }
    return this.isMuted;
  }

  static playSfx(type: 'attack' | 'hit' | 'levelup' | 'loot' | 'click' | 'fire' | 'exec' | 'sell' | 'death' | 'gong') {
    if (!this.ctx || this.isMuted) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.connect(gain);
    gain.connect(this.masterGain!);

    switch (type) {
      case 'attack':
        osc.type = 'triangle'; osc.frequency.setValueAtTime(600, t); osc.frequency.exponentialRampToValueAtTime(100, t+0.15);
        gain.gain.setValueAtTime(0.5, t); gain.gain.exponentialRampToValueAtTime(0.01, t+0.15);
        osc.start(t); osc.stop(t+0.15); break;
      case 'hit':
        osc.type = 'square'; osc.frequency.setValueAtTime(150, t); osc.frequency.exponentialRampToValueAtTime(40, t+0.1);
        gain.gain.setValueAtTime(0.8, t); gain.gain.exponentialRampToValueAtTime(0.01, t+0.1);
        osc.start(t); osc.stop(t+0.1); break;
      case 'levelup':
        osc.type = 'sine'; 
        [523.25, 659.25, 783.99, 1046.50].forEach((f, i) => { osc.frequency.setValueAtTime(f, t + i*0.1); });
        gain.gain.setValueAtTime(0.3, t); gain.gain.linearRampToValueAtTime(0.3, t+0.4); gain.gain.exponentialRampToValueAtTime(0.01, t+0.8);
        osc.start(t); osc.stop(t+0.8); break;
      case 'loot':
        osc.type = 'sine'; osc.frequency.setValueAtTime(1200, t);
        gain.gain.setValueAtTime(0.3, t); gain.gain.exponentialRampToValueAtTime(0.01, t+0.5);
        osc.start(t); osc.stop(t+0.5); break;
      case 'click':
        osc.type = 'sine'; osc.frequency.setValueAtTime(800, t);
        gain.gain.setValueAtTime(0.1, t); gain.gain.exponentialRampToValueAtTime(0.001, t+0.05);
        osc.start(t); osc.stop(t+0.05); break;
      case 'fire':
        osc.type = 'sawtooth'; osc.frequency.setValueAtTime(200, t); osc.frequency.linearRampToValueAtTime(50, t+0.5);
        gain.gain.setValueAtTime(0.5, t); gain.gain.linearRampToValueAtTime(0, t+0.5);
        osc.start(t); osc.stop(t+0.5); break;
      case 'exec':
        osc.type = 'square'; osc.frequency.setValueAtTime(100, t); 
        gain.gain.setValueAtTime(1, t); gain.gain.exponentialRampToValueAtTime(0.01, t+0.3);
        osc.start(t); osc.stop(t+0.3); break;
      case 'sell':
        osc.type = 'sine'; osc.frequency.setValueAtTime(1200, t); osc.frequency.linearRampToValueAtTime(1500, t+0.1);
        gain.gain.setValueAtTime(0.1, t); gain.gain.exponentialRampToValueAtTime(0.001, t+0.1);
        osc.start(t); osc.stop(t+0.1); break;
      case 'death':
        osc.type = 'sawtooth'; osc.frequency.setValueAtTime(100, t); osc.frequency.exponentialRampToValueAtTime(30, t+1.0);
        gain.gain.setValueAtTime(0.8, t); gain.gain.linearRampToValueAtTime(0, t+1.0);
        osc.start(t); osc.stop(t+1.0); break;
      case 'gong':
        osc.type = 'sine'; osc.frequency.setValueAtTime(100, t); 
        gain.gain.setValueAtTime(1, t); gain.gain.exponentialRampToValueAtTime(0.001, t+2.0);
        const osc2 = this.ctx.createOscillator();
        osc2.type = 'square'; osc2.frequency.setValueAtTime(102, t);
        osc2.connect(gain);
        osc.start(t); osc.stop(t+2.0); osc2.start(t); osc2.stop(t+2.0); break;
    }
  }

  static playBGM(zoneId: string) {
    if (!this.ctx || this.isMuted) return;
    if (this.currentZoneId === zoneId && this.bgmInterval) return;
    this.stopBGM();
    this.currentZoneId = zoneId;
    // Minimal BGM implementation
    this.bgmGain = this.ctx.createGain();
    this.bgmGain.connect(this.masterGain!);
    this.bgmGain.gain.value = 0.1;
    
    if (zoneId === 'elwynn') {
       // Simple ambient loop
       const osc = this.ctx.createOscillator();
       osc.type = 'sine'; osc.frequency.value = 100;
       osc.connect(this.bgmGain); osc.start();
       this.bgmOscillators.push(osc);
    }
  }
  
  static stopBGM() {
      if (this.bgmInterval) clearInterval(this.bgmInterval);
      this.bgmOscillators.forEach(o => { try { o.stop(); } catch(e){} });
      this.bgmOscillators = [];
  }
}

// --- MODULE: IdleWowUtil (Shared Utilities) ---
class IdleWowUtil {
  static uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  static randInt(min: number, max: number) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  static pick<T>(arr: T[]): T {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  static formatMoney(copper: number) {
    const gold = Math.floor(copper / 10000);
    const silver = Math.floor((copper % 10000) / 100);
    const c = Math.floor(copper % 100);
    return `${gold}金 ${silver}银 ${c}铜`;
  }

  static redistributeItemStats(item: Item): Item {
      if (!item.stats.int || item.stats.int <= 0) return item;
      const intVal = item.stats.int;
      const otherStats: StatType[] = ['str', 'agi', 'sta'];
      const newStats = { ...item.stats };
      delete newStats.int;
      for(let i = 0; i < intVal; i++) {
          const target = IdleWowUtil.pick(otherStats);
          newStats[target] = (newStats[target] || 0) + 1;
      }
      return { ...item, stats: newStats };
  }

  static SLOT_PREFIX = 'idlewow_save_slot_';

  static getSlotInfo(index: number) {
    try {
      const data = localStorage.getItem(`${IdleWowUtil.SLOT_PREFIX}${index}`);
      if (!data) return null;
      let parsed = JSON.parse(data);
      return {
        exists: true,
        username: parsed?.player?.username || '未知存档',
        level: parsed?.player?.level || 1,
        class: parsed?.player?.class || 'novice',
        timestamp: parsed?.timestamp || Date.now()
      };
    } catch (e) { return null; }
  }

  static loadSlot(index: number) {
    try {
        const data = localStorage.getItem(`${IdleWowUtil.SLOT_PREFIX}${index}`);
        if (!data) return null;
        let parsed = JSON.parse(data);
        
        // MIGRATION
        const defaultPlayer = IdleWowCore.getBaseStats(1, parsed.player?.username || 'Recovery');
        const mergedPlayer = { ...defaultPlayer, ...parsed.player };
        
        // Ensure new fields exist
        if (!mergedPlayer.class) mergedPlayer.class = 'novice';
        if (mergedPlayer.skillPoints === undefined) mergedPlayer.skillPoints = Math.max(0, mergedPlayer.level - 9);
        if (mergedPlayer.attributePoints === undefined) mergedPlayer.attributePoints = 0; 
        if (mergedPlayer.autoAllocMode === undefined) mergedPlayer.autoAllocMode = 'manual';
        if (!mergedPlayer.skills) mergedPlayer.skills = {};
        if (mergedPlayer.mana === undefined) mergedPlayer.mana = 0;
        if (mergedPlayer.rage === undefined) mergedPlayer.rage = 0;
        if (mergedPlayer.gameSpeed === undefined) mergedPlayer.gameSpeed = 1;
        if (mergedPlayer.reincarnationUnlocked === undefined) mergedPlayer.reincarnationUnlocked = false;
        if (mergedPlayer.reincarnationPower === undefined) mergedPlayer.reincarnationPower = 0;
        if (mergedPlayer.sixPathsPower === undefined) mergedPlayer.sixPathsPower = 0;
        if (mergedPlayer.furyEnabled === undefined) mergedPlayer.furyEnabled = false;
        if (mergedPlayer.passiveArts === undefined) mergedPlayer.passiveArts = [];
        // Migration for mobsKilled. If level > 1 assume not a new char.
        if (mergedPlayer.mobsKilled === undefined) mergedPlayer.mobsKilled = (mergedPlayer.level > 1 ? 10 : 0);

        return {
            ...parsed,
            player: mergedPlayer,
            equipment: parsed.equipment || { weapon: null, head: null, chest: null, legs: null },
            inventory: parsed.inventory || [],
            zoneId: parsed.zoneId || 'elwynn'
        };
    } catch (e) { return null; }
  }

  static saveToSlot(index: number, state: any) {
    try {
        localStorage.setItem(`${IdleWowUtil.SLOT_PREFIX}${index}`, JSON.stringify({ ...state, timestamp: Date.now() }));
    } catch (e) {}
  }
}

// --- MODULE: IdleWowCore (Business Logic) ---
const M_TYPES: MobTemplate['modelType'][] = ['humanoid', 'beast', 'mech', 'dragon', 'undead', 'demon', 'elemental'];

// Generate 20+ mobs for a zone
const generateZoneMobs = (zoneId: string, minLvl: number, maxLvl: number, typePrefixes: string[]): MobTemplate[] => {
    const mobs: MobTemplate[] = [];
    const count = 22;
    const adjs = ['疯狂的', '饥饿的', '堕落的', '狂暴的', '远古', '幼年', '变异的', '虚空', '精英', '流浪的', '被诅咒的'];
    
    for(let i=0; i<count; i++) {
        const lvl = Math.floor(minLvl + (i / count) * (maxLvl - minLvl));
        const isBoss = i === count - 1 || i === Math.floor(count/2);
        const typeStr = typePrefixes[i % typePrefixes.length];
        const name = `${adjs[i % adjs.length]}${typeStr}`;
        const model = i % 7 === 0 ? 'dragon' : (i % 3 === 0 ? 'humanoid' : 'beast'); // simplified model distribution
        
        mobs.push({
            id: `${zoneId}_${i}`,
            name: isBoss ? `[首领] ${name}` : name,
            level: lvl + (isBoss ? 2 : 0),
            baseHp: 20 + (lvl * 15) * (isBoss ? 5 : 1),
            minDmg: 1 + lvl * 1.5,
            maxDmg: 3 + lvl * 2.5,
            xpGiven: 10 + lvl * 5 * (isBoss ? 4 : 1),
            modelType: isBoss ? 'dragon' : M_TYPES[i % M_TYPES.length],
            color: Math.random() * 0xffffff,
            isBoss
        });
    }
    return mobs;
};

const ZONES: Zone[] = [
  { id: 'elwynn', name: '艾尔文森林 (1-10)', minLevel: 1, maxLevel: 10, mobs: generateZoneMobs('elwynn', 1, 10, ['野狼', '狗头人', '野猪', '强盗', '蜘蛛', '卫兵']) },
  { id: 'westfall', name: '西部荒野 (10-20)', minLevel: 10, maxLevel: 20, mobs: generateZoneMobs('westfall', 10, 20, ['麦田傀儡', '迪菲亚暴徒', '秃鹫', '野猪', '甚至收割机']) },
  { id: 'redridge', name: '赤脊山 (20-30)', minLevel: 20, maxLevel: 30, mobs: generateZoneMobs('redridge', 20, 30, ['黑石兽人', '暗皮豺狼人', '狼蛛', '黑龙雏龙', '暗影法师']) },
  { id: 'duskwood', name: '暮色森林 (30-40)', minLevel: 30, maxLevel: 40, mobs: generateZoneMobs('duskwood', 30, 40, ['骷髅战士', '食尸鬼', '狼人', '幽灵', '黑寡妇蜘蛛', '缝合怪']) },
  { id: 'stranglethorn', name: '荆棘谷 (40-50)', minLevel: 40, maxLevel: 50, mobs: generateZoneMobs('stv', 40, 50, ['丛林猛虎', '迅猛龙', '血顶巨魔', '大猩猩', '海盗', '娜迦']) },
  { id: 'burningsteppes', name: '燃烧平原 (50-60)', minLevel: 50, maxLevel: 60, mobs: generateZoneMobs('bs', 50, 60, ['黑石食人魔', '火元素', '小鬼', '黑龙军团士兵', '岩浆巨人']) },
  { id: 'outland', name: '外域 (60-70)', minLevel: 60, maxLevel: 70, mobs: generateZoneMobs('outland', 60, 70, ['地狱野猪', '恶魔卫士', '虚空行者', '邪兽人', '孢子蝠', '魔能机甲']) },
  { id: 'northrend', name: '诺森德 (70-80)', minLevel: 70, maxLevel: 80, mobs: generateZoneMobs('north', 70, 80, ['维库人', '冰巨魔', '天灾军团', '猛犸象', '始祖龙', '冰雪亡魂']) },
  { id: 'pandaria', name: '潘达利亚 (80-90)', minLevel: 80, maxLevel: 90, mobs: generateZoneMobs('panda', 80, 90, ['猢狲', '锦鱼人', '魔古族', '野牛人', '螳螂妖', '煞魔']) },
  { id: 'brokenisles', name: '破碎群岛 (90-100+)', minLevel: 90, maxLevel: 110, mobs: generateZoneMobs('legion', 90, 110, ['燃烧军团守卫', '鬼母', '邪能领主', '深渊领主', '审判官', '萨格拉斯之眼']) },
];

class IdleWowCore {
  static getBaseStats(level: number, username: string): PlayerStats {
    return {
      username,
      class: 'novice',
      str: 5,
      agi: 5,
      int: 5,
      sta: 5,
      attributePoints: Math.max(0, (level - 1) * 1), 
      autoAllocMode: 'manual',
      hp: 50, maxHp: 50, // Fixed: Initialize hp to >0 to prevent instant death
      mana: 50, maxMana: 50,
      rage: 0,
      xp: 0, maxXp: level * 100,
      level: level,
      skillPoints: Math.max(0, level - 9), 
      skills: {},
      mobsKilled: 0,
      gold: 0,
      potions: 0,
      godModeEnabled: username === 'cnm',
      godModeAutoEquip: false,
      gameSpeed: 1,
      reincarnationUnlocked: false,
      reincarnationPower: 0,
      sixPathsPower: 0,
      furyEnabled: false,
      passiveArts: []
    };
  }

  static calculateCombatStats(base: PlayerStats, equipment: Record<ItemSlot, Item | null>) {
    let { str, agi, int, sta } = base;

    // Apply Equipment Stats
    Object.values(equipment).forEach(item => {
      if (!item) return;
      str += item.stats.str || 0;
      agi += item.stats.agi || 0;
      int += item.stats.int || 0;
      sta += item.stats.sta || 0;
    });

    // Apply Passive Arts Stats
    base.passiveArts.forEach(artId => {
        const art = MARTIAL_ARTS_DB.find(a => a.id === artId);
        if (art) {
            str += art.stats.str || 0;
            agi += art.stats.agi || 0;
            int += art.stats.int || 0;
            sta += art.stats.sta || 0;
        }
    });

    // Apply Fury Multiplier
    if (base.furyEnabled) {
        str *= 2;
        agi *= 2;
        int *= 2;
        sta *= 2;
    }

    const maxHp = sta * 10;
    const maxMana = int * 10; 
    const ap = str * 2;
    
    let critChance = agi * 0.05; 
    let critDmgMultiplier = 2.0; 
    if (critChance > 1.0) {
        const excess = critChance - 1.0;
        critDmgMultiplier += excess; 
        critChance = 1.0;
    }

    const dps = 5 + (ap / 14);

    return { str, agi, int, sta, maxHp, maxMana, ap, crit: critChance, critDmg: critDmgMultiplier, dps };
  }

  static calculateItemScore(item: Item): number {
      let score = 0;
      score += (item.stats.str || 0) * 10;
      score += (item.stats.agi || 0) * 10;
      score += (item.stats.int || 0) * 10;
      score += (item.stats.sta || 0) * 10;
      
      const qualMult = { poor: 0, common: 1, rare: 2, epic: 5 };
      score += (qualMult[item.quality] || 0) * 5;
      
      return Math.floor(score);
  }

  static generateLoot(targetLevel: number, forcedQuality?: ItemQuality, godMode?: boolean): Item | null {
    if (!forcedQuality && Math.random() > 0.3) return null;
    const qualities: ItemQuality[] = ['common', 'common', 'common', 'rare', 'rare', 'epic'];
    const quality = forcedQuality || qualities[Math.floor(Math.random() * (Math.random() > 0.9 ? qualities.length : 3))]; 
    const slots: ItemSlot[] = ['weapon', 'head', 'chest', 'legs'];
    const slot = IdleWowUtil.pick(slots);
    const prefixes = ['强力的', '迅捷的', '睿智的', '坚固的', '锋利的', '野蛮的', '光芒的', '黑暗的', '神圣的'];
    const suffixes = ['之熊', '之猛虎', '之枭兽', '之灵猴', '之巨鲸', '之野狼', '之猎鹰', '之大象'];
    const baseNames: Record<ItemSlot, string> = { weapon: '长剑', head: '头盔', chest: '胸甲', legs: '护腿' };
    const name = `${IdleWowUtil.pick(prefixes)}${baseNames[slot]}${IdleWowUtil.pick(suffixes)}`;
    const multiplier = quality === 'epic' ? 3 : (quality === 'rare' ? 2 : 1);
    
    const budget = Math.max(1, Math.ceil((targetLevel * 1.5) * multiplier));
    
    const stats: Partial<Record<StatType, number>> = {};
    const statTypes: StatType[] = ['str', 'agi', 'int', 'sta'];
    for(let i=0; i<budget; i++) {
      const s = IdleWowUtil.pick(statTypes);
      stats[s] = (stats[s] || 0) + 1;
    }
    
    let item: Item = { 
        id: IdleWowUtil.uuid(), 
        name, 
        slot, 
        quality, 
        stats, 
        value: budget * 10,
        reqLevel: targetLevel,
        score: 0
    };
    
    if (godMode) item = IdleWowUtil.redistributeItemStats(item);
    
    item.score = IdleWowCore.calculateItemScore(item);

    return item;
  }

  static formatItemStats(item: Item): string {
     const map: Record<StatType, string> = { str: '力量', agi: '敏捷', int: '智力', sta: '耐力' };
     let text = `${item.name}\n品质: ${QUALITY_CN[item.quality]}\n部位: ${SLOT_CN[item.slot]}\n装备评分: ${item.score}\n需求等级: ${item.reqLevel}\n售价: ${IdleWowUtil.formatMoney(item.value)}\n`;
     Object.entries(item.stats).forEach(([key, val]) => { text += `+${val} ${map[key as StatType]}\n`; });
     return text;
  }

  static getSkillDamage(skillId: SkillId, rank: number, baseMult: number): number {
      // Skill Upgrade Effect: Each rank adds 10% to base multiplier logic
      // Formula: BaseMult * (1 + (Rank-1) * 0.1)
      if (rank <= 0) return baseMult;
      return baseMult * (1 + (rank - 1) * 0.1);
  }
}

// --- VISUAL COMPONENT: 3D Combat View ---
const CombatScene = ({ mobTemplate, playerClass, playerModelOverride, playerAttackAnim, mobAttackAnim }: { mobTemplate: MobTemplate | null, playerClass: PlayerClass, playerModelOverride?: string, playerAttackAnim: boolean, mobAttackAnim: boolean }) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const playerGroup = useRef<THREE.Group>(null);
  const mobGroup = useRef<THREE.Group>(null);
  const sceneRef = useRef<THREE.Scene>(null);

  const createMesh = (type: string, color: number, isBoss: boolean = false, subClass?: PlayerClass): THREE.Group => {
    const group = new THREE.Group();
    const material = new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.2 });

    if (type === 'player') {
        if (subClass === 'mage') {
            const bodyGeo = new THREE.CylinderGeometry(0.4, 0.6, 1.6, 8);
            const body = new THREE.Mesh(bodyGeo, new THREE.MeshStandardMaterial({ color: 0x8a2be2 }));
            body.position.y = 0.8;
            const headGeo = new THREE.SphereGeometry(0.35, 16, 16);
            const head = new THREE.Mesh(headGeo, new THREE.MeshStandardMaterial({ color: 0xffccaa }));
            head.position.y = 1.8;
            const staffGeo = new THREE.CylinderGeometry(0.05, 0.05, 2, 8);
            const staff = new THREE.Mesh(staffGeo, new THREE.MeshStandardMaterial({ color: 0x8b4513 }));
            staff.position.set(0.6, 1, 0.5);
            staff.rotation.x = Math.PI / 8;
            const orbGeo = new THREE.SphereGeometry(0.15);
            const orb = new THREE.Mesh(orbGeo, new THREE.MeshStandardMaterial({ color: 0x00ffff, emissive: 0x00ffff }));
            orb.position.set(0, 1, 0);
            staff.add(orb);
            group.add(body, head, staff);
        } else if (subClass === 'warrior') {
            const bodyGeo = new THREE.BoxGeometry(0.8, 1.6, 0.5);
            const body = new THREE.Mesh(bodyGeo, new THREE.MeshStandardMaterial({ color: 0x8b0000 }));
            body.position.y = 0.8;
            const headGeo = new THREE.BoxGeometry(0.5, 0.6, 0.5);
            const head = new THREE.Mesh(headGeo, new THREE.MeshStandardMaterial({ color: 0x555555 }));
            head.position.y = 1.8;
            const swordGeo = new THREE.BoxGeometry(0.2, 1.8, 0.1);
            const sword = new THREE.Mesh(swordGeo, new THREE.MeshStandardMaterial({ color: 0xc0c0c0 }));
            sword.position.set(0.7, 1, 0.5);
            sword.rotation.x = Math.PI / 4;
            group.add(body, head, sword);
        } else {
            const bodyGeo = new THREE.CylinderGeometry(0.5, 0.3, 1.5, 8);
            const body = new THREE.Mesh(bodyGeo, new THREE.MeshStandardMaterial({ color: 0x0070dd }));
            body.position.y = 0.75;
            const headGeo = new THREE.SphereGeometry(0.35, 16, 16);
            const head = new THREE.Mesh(headGeo, new THREE.MeshStandardMaterial({ color: 0xffccaa }));
            head.position.y = 1.7;
            const swordGeo = new THREE.BoxGeometry(0.1, 1.2, 0.1);
            const sword = new THREE.Mesh(swordGeo, new THREE.MeshStandardMaterial({ color: 0xeeeeee }));
            sword.position.set(0.6, 1, 0.5);
            sword.rotation.x = Math.PI / 4;
            group.add(body, head, sword);
        }
    } else if (type === 'dragon') {
        const body = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 16), material);
        body.position.y = 1.5; body.scale.set(1, 0.8, 1.5);
        const wings = new THREE.Mesh(new THREE.BoxGeometry(4, 0.1, 1), new THREE.MeshStandardMaterial({color: 0x111}));
        wings.position.y = 1.8;
        const head = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 1), material);
        head.position.set(0, 2, 1.2);
        group.add(body, wings, head);
    } else if (type === 'mech') {
        const body = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.5, 1), material);
        body.position.y = 1;
        group.add(body);
    } else { 
        const body = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.4, 1.6, 8), material);
        body.position.y = 0.8;
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.4), material);
        head.position.y = 1.8;
        group.add(body, head);
    }

    if (isBoss) group.scale.set(1.8, 1.8, 1.8);
    return group;
  };

  useEffect(() => {
    if(!mountRef.current) return;
    const w = mountRef.current.clientWidth;
    const h = mountRef.current.clientHeight;
    const scene = new THREE.Scene();
    sceneRef.current = scene;
    scene.background = new THREE.Color(0x111111);
    scene.add(new THREE.GridHelper(30, 30, 0x333333, 0x1a1a1a));
    const camera = new THREE.PerspectiveCamera(45, w/h, 0.1, 100);
    camera.position.set(-8, 6, 8);
    camera.lookAt(0, 1.5, 0);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(w, h);
    mountRef.current.appendChild(renderer.domElement);
    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const point = new THREE.PointLight(0xffd700, 1.8);
    point.position.set(2, 8, 4);
    scene.add(point);

    const animate = () => {
      requestAnimationFrame(animate);
      const time = Date.now() * 0.002;
      if (playerGroup.current) playerGroup.current.position.y = Math.sin(time) * 0.05;
      if (mobGroup.current) mobGroup.current.position.y = Math.sin(time + 1) * 0.05;
      renderer.render(scene, camera);
    };
    animate();
    return () => { mountRef.current?.removeChild(renderer.domElement); renderer.dispose(); }
  }, []);

  useEffect(() => {
      if (!sceneRef.current) return;
      if (playerGroup.current) sceneRef.current.remove(playerGroup.current);
      let type = playerModelOverride || 'player';
      let color = playerModelOverride ? 0xffd700 : 0x0070dd;
      playerGroup.current = createMesh(type, color, false, playerClass);
      playerGroup.current.position.set(-2.5, 0, 0);
      playerGroup.current.rotation.y = Math.PI / 2;
      sceneRef.current.add(playerGroup.current);
  }, [playerClass, playerModelOverride]);

  useEffect(() => {
      if (!sceneRef.current) return;
      if (mobGroup.current) sceneRef.current.remove(mobGroup.current);
      if (mobTemplate) {
          mobGroup.current = createMesh(mobTemplate.modelType, mobTemplate.color, mobTemplate.isBoss);
          mobGroup.current.position.set(2.5, 0, 0);
          mobGroup.current.rotation.y = -Math.PI / 2;
          sceneRef.current.add(mobGroup.current);
      }
  }, [mobTemplate]);

  useEffect(() => {
    if(playerGroup.current && playerAttackAnim) {
      const originalX = -2.5;
      let start = Date.now();
      const anim = setInterval(() => {
          const delta = Date.now() - start;
          if (delta > 300) { if(playerGroup.current) playerGroup.current.position.x = originalX; clearInterval(anim); } 
          else if (playerGroup.current) { const offset = delta < 150 ? (delta/150)*1.5 : (1-(delta-150)/150)*1.5; playerGroup.current.position.x = originalX + offset; }
      }, 16);
    }
  }, [playerAttackAnim]);

  useEffect(() => {
    if(mobGroup.current && mobAttackAnim) {
      const originalX = 2.5;
      let start = Date.now();
      const anim = setInterval(() => {
          const delta = Date.now() - start;
          if (delta > 300) { if(mobGroup.current) mobGroup.current.position.x = originalX; clearInterval(anim); } 
          else if (mobGroup.current) { const offset = delta < 150 ? (delta/150)*1.5 : (1-(delta-150)/150)*1.5; mobGroup.current.position.x = originalX - offset; }
      }, 16);
    }
  }, [mobAttackAnim]);

  return <div ref={mountRef} className="three-canvas" />;
}

// --- MAIN APP: IdleWowGame ---
const App = () => {
  const [appMode, setAppMode] = useState<'slot-select' | 'create-char' | 'game'>('slot-select');
  const [currentSlot, setCurrentSlot] = useState<number>(0);
  const [createName, setCreateName] = useState('');

  const [player, setPlayer] = useState<PlayerStats>(IdleWowCore.getBaseStats(1, ''));
  const [equipment, setEquipment] = useState<Record<ItemSlot, Item | null>>({ weapon: null, head: null, chest: null, legs: null });
  const [inventory, setInventory] = useState<Item[]>([]);
  const [zone, setZone] = useState<Zone>(ZONES[0]);
  
  const [combat, setCombat] = useState<{
    mob: { template: MobTemplate, hp: number, maxHp: number, slowed?: boolean } | null,
    pAnim: boolean, mAnim: boolean
  }>({ mob: null, pAnim: false, mAnim: false });

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [activeTab, setActiveTab] = useState('char');
  
  const [tempAlloc, setTempAlloc] = useState<Record<StatType, number>>({ str: 0, agi: 0, int: 0, sta: 0 });
  
  const [showWelcomeModal, setShowWelcomeModal] = useState(false);
  const [showGodToggleModal, setShowGodToggleModal] = useState(false);
  const [showClassModal, setShowClassModal] = useState(false);
  const [showReincarnationModal, setShowReincarnationModal] = useState(false);

  const derivedStats = IdleWowCore.calculateCombatStats(player, equipment);
  const isGod = player.username === 'cnm';
  
  const tempPointsSpent = Object.values(tempAlloc).reduce((a, b) => a + b, 0);
  const pointsAvailable = player.attributePoints - tempPointsSpent;

  const showTooltip = useCallback((e: React.MouseEvent, content: string) => {
    const el = document.getElementById('global-tooltip');
    if (el) { el.style.display = 'block'; el.innerText = content; moveTooltip(e); }
  }, []);
  const moveTooltip = useCallback((e: React.MouseEvent) => {
     const el = document.getElementById('global-tooltip');
     if (el) {
         let x = e.clientX + 15; let y = e.clientY + 15;
         const rect = el.getBoundingClientRect();
         if (x + rect.width > window.innerWidth) x = e.clientX - rect.width - 5;
         if (y + rect.height > window.innerHeight) y = e.clientY - rect.height - 5;
         el.style.left = `${x}px`; el.style.top = `${y}px`;
     }
  }, []);
  const hideTooltip = useCallback(() => { const el = document.getElementById('global-tooltip'); if (el) el.style.display = 'none'; }, []);

  const addLog = (text: string, type: LogEntry['type']) => {
    setLogs(prev => [{ id: IdleWowUtil.uuid(), text, type, timestamp: Date.now() }, ...prev].slice(0, 50));
  };

  useEffect(() => {
      if (appMode !== 'game') return;
      const saveInterval = setInterval(() => {
          IdleWowUtil.saveToSlot(currentSlot, { player, equipment, inventory, zoneId: zone.id });
      }, 5000); 
      return () => clearInterval(saveInterval);
  }, [appMode, currentSlot, player, equipment, inventory, zone]);

  // --- COMBAT LOOP ---
  useEffect(() => {
    if (appMode !== 'game') return;
    if (showWelcomeModal) return; // Pause game while welcome/god modal is open

    const tickRate = 1000 / (player.gameSpeed || 1);

    const interval = setInterval(() => {
      setPlayer(p => {
          let newMana = p.mana;
          let newRage = p.rage;
          if (p.class === 'mage' && p.mana < derivedStats.maxMana) {
              newMana = Math.min(derivedStats.maxMana, p.mana + (derivedStats.int * 0.1));
          }
          if (p.class === 'warrior' && combat.mob === null && p.rage > 0) {
              newRage = Math.max(0, p.rage - 2);
          }
          let newHp = Math.min(derivedStats.maxHp, p.hp + (derivedStats.sta * 0.2));
          
          if (newMana !== p.mana || newRage !== p.rage || newHp !== p.hp) {
              return { ...p, mana: newMana, rage: newRage, hp: newHp };
          }
          return p;
      });

      setCombat(prev => {
        let currentMob = prev.mob;
        let pAnim = false;
        let mAnim = false;

        if (!currentMob) {
          // New Character Tutorial Protection: First 3 mobs are Level 1 weaklings
          if (player.mobsKilled < 3) {
             const tutorialMob: MobTemplate = {
                 id: `tut_${player.mobsKilled}`,
                 name: '虚弱的幼狼',
                 level: 1,
                 baseHp: 15,
                 minDmg: 1,
                 maxDmg: 2,
                 xpGiven: 20,
                 modelType: 'beast',
                 color: 0x888888,
                 isBoss: false
             };
             currentMob = { template: tutorialMob, hp: tutorialMob.baseHp, maxHp: tutorialMob.baseHp };
          } else {
             const template = IdleWowUtil.pick(zone.mobs) as MobTemplate;
             const hpMult = template.isBoss ? 3 : 1;
             currentMob = { template, hp: template.baseHp * hpMult, maxHp: template.baseHp * hpMult };
          }
        }

        if (player.hp > 0 && currentMob.hp > 0) {
          // PLAYER TURN
          let damage = Math.floor(IdleWowUtil.randInt(derivedStats.ap/4, derivedStats.ap/2));
          let isCrit = Math.random() < derivedStats.crit;
          let skillMsg = '';

          let skillUsed = false;
          const availableSkills = Object.keys(player.skills).map(id => SKILL_DB[id as SkillId]);
          
          for (const skill of availableSkills) {
              let canCast = false;
              if (skill.costType === 'rage' && player.rage >= skill.cost) canCast = true;
              if (skill.costType === 'mana' && player.mana >= (derivedStats.maxMana * (skill.cost/100))) canCast = true;
              if (skill.id === 'execute' && (currentMob.hp / currentMob.maxHp) > 0.2) canCast = false;

              if (canCast && Math.random() < 0.3) {
                  const rank = player.skills[skill.id] || 1;
                  const realMult = IdleWowCore.getSkillDamage(skill.id, rank, skill.dmgMult);
                  
                  damage *= realMult;
                  skillMsg = ` [${skill.name}]`;
                  skillUsed = true;
                  
                  setPlayer(p => {
                      if (skill.costType === 'rage') return { ...p, rage: p.rage - skill.cost };
                      if (skill.costType === 'mana') return { ...p, mana: p.mana - (derivedStats.maxMana * (skill.cost/100)) };
                      return p;
                  });

                  if (skill.id === 'frostbolt') {
                      currentMob.slowed = true;
                      addLog(`${currentMob.template.name} 被减速了!`, 'skill');
                  }
                  
                  IdleWowAudio.playSfx(skill.reqClass === 'mage' ? 'fire' : 'exec');
                  break; 
              }
          }

          if (isCrit) damage *= derivedStats.critDmg;
          currentMob.hp -= damage;
          pAnim = true;
          addLog(`你${skillMsg}击中了 ${currentMob.template.name} 造成 ${Math.floor(damage)} 伤害${isCrit ? ' (暴击!)' : ''}`, skillUsed ? 'skill' : 'dmg');
          if (!skillUsed) IdleWowAudio.playSfx('attack');

          if (player.class === 'warrior') {
              setPlayer(p => ({ ...p, rage: Math.min(100, p.rage + 5) }));
          }

          // MOB TURN
          if (currentMob.hp > 0) {
            if (!currentMob.slowed || Math.random() > 0.5) {
                const mDmg = IdleWowUtil.randInt(currentMob.template.minDmg, currentMob.template.maxDmg);
                const dodgeChance = derivedStats.agi * 0.001;
                if (Math.random() < dodgeChance) {
                   addLog(`你躲闪了 ${currentMob.template.name} 的攻击!`, 'sys');
                } else {
                   mAnim = true;
                   setPlayer(p => {
                       const newRage = p.class === 'warrior' ? Math.min(100, p.rage + 2) : p.rage;
                       return { ...p, hp: Math.max(0, p.hp - mDmg), rage: newRage };
                   });
                   addLog(`${currentMob.template.name} 击中你造成 ${mDmg} 点伤害`, 'dmg');
                   setTimeout(() => IdleWowAudio.playSfx('hit'), Math.min(200, tickRate / 2));
                }
            }
          }
        }

        if (currentMob.hp <= 0) {
          addLog(`${currentMob.template.name} 死亡。`, 'sys');
          
          // Disable Fury if active
          if (player.furyEnabled) {
              setPlayer(p => ({ ...p, furyEnabled: false }));
              addLog('狂怒效果已消散。', 'sys');
          }

          const xpGain = currentMob.template.xpGiven * (currentMob.template.isBoss ? 2 : 1);
          const goldGain = IdleWowUtil.randInt(1, 5) * currentMob.template.level * (currentMob.template.isBoss ? 5 : 1);

          setPlayer(p => {
            let newXp = p.xp + xpGain;
            let newLvl = p.level;
            let newMaxXp = p.maxXp;
            let gold = p.gold + goldGain;
            let pts = p.skillPoints;
            let attPts = p.attributePoints;
            let pStr = p.str, pAgi = p.agi, pInt = p.int, pSta = p.sta;
            const killed = (p.mobsKilled || 0) + 1;
            
            if (newXp >= newMaxXp) {
              newXp -= newMaxXp;
              newLvl++;
              newMaxXp = newLvl * 100;
              
              // Auto Allocation Logic
              if (p.autoAllocMode !== 'manual') {
                  if (p.autoAllocMode === 'str') pStr++;
                  else if (p.autoAllocMode === 'agi') pAgi++;
                  else if (p.autoAllocMode === 'int') pInt++;
                  else if (p.autoAllocMode === 'sta') pSta++;
                  else if (p.autoAllocMode === 'str_agi') {
                      if (newLvl % 2 === 0) pStr++; else pAgi++;
                  }
                  else if (p.autoAllocMode === 'int_sta') {
                      if (newLvl % 2 === 0) pInt++; else pSta++;
                  }
                  addLog('属性点已自动分配。', 'sys');
              } else {
                  attPts += 1;
              }
              
              if (newLvl >= 10) pts++;
              
              IdleWowAudio.playSfx('levelup');
              return { ...p, xp: newXp, level: newLvl, maxXp: newMaxXp, gold, hp: derivedStats.maxHp, skillPoints: pts, attributePoints: attPts, str: pStr, agi: pAgi, int: pInt, sta: pSta, mobsKilled: killed };
            }
            return { ...p, xp: newXp, level: newLvl, maxXp: newMaxXp, gold, skillPoints: pts, attributePoints: attPts, mobsKilled: killed };
          });
          
          if(player.xp + xpGain >= player.maxXp) addLog(`升级! 你现在是等级 ${player.level + 1}`, 'sys');

          const loot = IdleWowCore.generateLoot(currentMob.template.level, currentMob.template.isBoss ? 'rare' : undefined, player.godModeEnabled);
          
          if (loot) {
            if (player.godModeAutoEquip) {
                const currentEquip = equipment[loot.slot];
                const currentScore = currentEquip ? IdleWowCore.calculateItemScore(currentEquip) : -1;
                
                if (loot.score > currentScore) {
                   if (currentEquip) {
                       setPlayer(p => ({...p, gold: p.gold + currentEquip.value}));
                       IdleWowAudio.playSfx('sell');
                   }
                   setEquipment(prev => ({...prev, [loot.slot]: loot}));
                   addLog(`[神之自动] 装备了更好物品: ${loot.name} (评分: ${loot.score})`, 'loot');
                   IdleWowAudio.playSfx('click');
                } else {
                   setPlayer(p => ({...p, gold: p.gold + loot.value}));
                   addLog(`[神之自动] 分解了低级物品: ${loot.name} (评分: ${loot.score})`, 'sys');
                   IdleWowAudio.playSfx('sell');
                }
            } else {
                setInventory(inv => {
                    if(inv.length < 20) return [...inv, loot];
                    addLog('背包已满!', 'sys');
                    return inv;
                });
                addLog(`拾取: [${loot.name}]`, 'loot');
                IdleWowAudio.playSfx('loot');
            }
          }
          return { mob: null, pAnim, mAnim };
        }

        if (player.hp <= 0) {
             // DEATH PENALTY LOGIC
             setPlayer(p => {
                 let newLvl = Math.max(1, p.level - 1);
                 let newMaxXp = newLvl * 100;
                 let newAttPts = p.attributePoints;
                 let newStr = p.str, newAgi = p.agi, newInt = p.int, pSta = p.sta;

                 // Revoke Attribute Point
                 if (p.level > 1) {
                     if (newAttPts > 0) {
                         newAttPts--;
                     } else {
                         // Remove from highest stat if no unspent points
                         const stats = [{k: 'str', v: p.str}, {k: 'agi', v: p.agi}, {k: 'int', v: p.int}, {k: 'sta', v: p.sta}];
                         stats.sort((a,b) => b.v - a.v);
                         const target = stats[0].k;
                         if (target === 'str') newStr = Math.max(5, newStr - 1);
                         else if (target === 'agi') newAgi = Math.max(5, newAgi - 1);
                         else if (target === 'int') newInt = Math.max(5, newInt - 1);
                         else if (target === 'sta') pSta = Math.max(5, pSta - 1);
                     }
                 }
                 
                 // Reincarnation Logic
                 let reincarnated = p.reincarnationUnlocked;
                 if (!reincarnated) {
                     setShowReincarnationModal(true);
                     reincarnated = true;
                     IdleWowAudio.playSfx('gong');
                 }

                 return {
                     ...p,
                     level: newLvl,
                     maxXp: newMaxXp,
                     // xp: 0, // REMOVED: Keep XP on death
                     hp: derivedStats.maxHp, // Revive
                     attributePoints: newAttPts,
                     str: newStr, agi: newAgi, int: newInt, sta: pSta,
                     reincarnationUnlocked: reincarnated,
                     reincarnationPower: p.reincarnationPower + 1,
                     furyEnabled: false // Reset fury on death
                 };
             });

             // ZONE REGRESSION
             const currentZoneIndex = ZONES.findIndex(z => z.id === zone.id);
             if (currentZoneIndex > 0) {
                 const prevZone = ZONES[currentZoneIndex - 1];
                 setZone(prevZone);
                 addLog(`你死亡了! 等级下降至 ${Math.max(1, player.level - 1)}，撤退至 ${prevZone.name}`, 'sys');
             } else {
                 addLog(`你死亡了! 等级下降至 ${Math.max(1, player.level - 1)}`, 'sys');
             }
             
             IdleWowAudio.playSfx('death');
             return { mob: null, pAnim, mAnim };
        }

        return { mob: currentMob, pAnim, mAnim };
      });
    }, tickRate); 

    return () => clearInterval(interval);
  }, [appMode, zone, derivedStats, player.godModeEnabled, player.godModeAutoEquip, player.gameSpeed, equipment, player.autoAllocMode, player.furyEnabled, showWelcomeModal]); 

  // --- UI HANDLERS ---
  const changeClass = (newClass: PlayerClass) => {
      setPlayer(p => ({ ...p, class: newClass }));
      setShowClassModal(false);
      addLog(`你转职成为了 ${newClass === 'warrior' ? '战士' : '法师'}!`, 'sys');
      IdleWowAudio.playSfx('levelup');
  };

  const learnSkill = (skillId: SkillId) => {
      if (player.skillPoints > 0) {
          setPlayer(p => ({
              ...p,
              skillPoints: p.skillPoints - 1,
              skills: { ...p.skills, [skillId]: (p.skills[skillId] || 0) + 1 }
          }));
          IdleWowAudio.playSfx('click');
      }
  };

  const setModelOverride = (model: string) => {
      setPlayer(p => ({...p, modelOverride: model}));
      setShowGodToggleModal(false);
  }

  const equipItem = (item: Item) => {
      if (player.level < item.reqLevel) {
          addLog(`等级不足! 需要等级: ${item.reqLevel}`, 'sys');
          return;
      }
      setEquipment(p => ({...p, [item.slot]: item})); 
      setInventory(inv => [...inv.filter(i=>i.id!==item.id), ...(equipment[item.slot]?[equipment[item.slot]!]:[])]);
      IdleWowAudio.playSfx('click');
  }

  const buyMysteryItem = () => {
      if (player.gold >= 2000) {
          setPlayer(p => ({...p, gold: p.gold - 2000}));
          const loot = IdleWowCore.generateLoot(player.level, undefined, player.godModeEnabled);
          if (loot) {
               if (player.godModeAutoEquip) {
                   const currentEquip = equipment[loot.slot];
                   const currentScore = currentEquip ? IdleWowCore.calculateItemScore(currentEquip) : -1;
                   if (loot.score > currentScore) {
                       if (currentEquip) setPlayer(p => ({...p, gold: p.gold + currentEquip.value}));
                       setEquipment(prev => ({...prev, [loot.slot]: loot}));
                       addLog(`[自动] 购买并装备: ${loot.name}`, 'loot');
                   } else {
                       setPlayer(p => ({...p, gold: p.gold + loot.value}));
                       addLog(`[自动] 购买并分解: ${loot.name}`, 'sys');
                   }
               } else {
                   setInventory(inv => {
                      if(inv.length < 20) return [...inv, loot];
                      addLog('背包已满!', 'sys');
                      return inv;
                   });
                   addLog(`购买获得: [${loot.name}]`, 'loot');
               }
               IdleWowAudio.playSfx('loot');
          }
      } else {
          addLog("金币不足!", 'sys');
      }
  };

  const resetStats = () => {
      if (player.gold >= 1000) {
          const totalStats = player.str + player.agi + player.int + player.sta;
          const baseTotal = 20; 
          const refund = Math.max(0, totalStats - baseTotal) + player.attributePoints;
          
          setPlayer(p => ({
              ...p,
              str: 5, agi: 5, int: 5, sta: 5,
              attributePoints: refund,
              gold: p.gold - 1000
          }));
          setTempAlloc({ str: 0, agi: 0, int: 0, sta: 0 });
          addLog("属性点已重置。", 'sys');
          IdleWowAudio.playSfx('click');
      } else addLog("金币不足 (需要 10 银币)", 'sys');
  };

  const resetSkills = () => {
      if (player.gold >= 1000) {
          let refund = player.skillPoints;
          Object.values(player.skills).forEach(rank => refund += (rank || 0));
          setPlayer(p => ({
              ...p,
              skillPoints: refund,
              skills: {},
              gold: p.gold - 1000
          }));
          addLog("技能点已重置。", 'sys');
          IdleWowAudio.playSfx('click');
      } else addLog("金币不足 (需要 10 银币)", 'sys');
  };

  const confirmStats = () => {
      if (tempPointsSpent > 0) {
          setPlayer(p => ({
              ...p,
              str: p.str + tempAlloc.str,
              agi: p.agi + tempAlloc.agi,
              int: p.int + tempAlloc.int,
              sta: p.sta + tempAlloc.sta,
              attributePoints: p.attributePoints - tempPointsSpent
          }));
          setTempAlloc({ str: 0, agi: 0, int: 0, sta: 0 });
          IdleWowAudio.playSfx('levelup');
          addLog(`属性加点完成!`, 'sys');
      }
  };

  const activateFury = () => {
      if (player.reincarnationPower >= 10) {
          setPlayer(p => ({
              ...p,
              reincarnationPower: p.reincarnationPower - 10,
              sixPathsPower: p.sixPathsPower + 1,
              furyEnabled: true
          }));
          addLog('>>> 轮回爆发! 狂怒模式开启! 下一场战斗属性翻倍! <<<', 'sys');
          IdleWowAudio.playSfx('gong');
      } else {
          addLog('轮回之力不足!', 'sys');
      }
  };

  const buyMartialArt = (art: MartialArt) => {
      if (player.sixPathsPower >= art.cost) {
          if (player.passiveArts.includes(art.id)) {
              addLog('你已经学会了这个内功。', 'sys');
              return;
          }
          setPlayer(p => ({
              ...p,
              sixPathsPower: p.sixPathsPower - art.cost,
              passiveArts: [...p.passiveArts, art.id]
          }));
          addLog(`习得内功: [${art.name}]`, 'sys');
          IdleWowAudio.playSfx('levelup');
      } else {
          addLog('六道轮回之力不足!', 'sys');
      }
  };

  // --- RENDER ---
  if (appMode === 'slot-select') {
    return (
      <div className="slot-screen">
          <h1 className="login-title">选择存档</h1>
          <div style={{color: '#666', marginBottom: '20px'}}>IdleWow v2.5 - 华夏轮回系统</div>
          <div className="save-slots-container">
            {[0, 1, 2].map(i => {
                const info = IdleWowUtil.getSlotInfo(i);
                const classNames = { novice: '新手', warrior: '战士', mage: '法师' };
                return (
                    <div key={i} className="save-slot-card" onClick={() => {
                        IdleWowAudio.init(); IdleWowAudio.playSfx('click');
                        setCurrentSlot(i);
                        const saved = IdleWowUtil.loadSlot(i);
                        if (saved) {
                            setPlayer(saved.player); setEquipment(saved.equipment); setInventory(saved.inventory);
                            const z = ZONES.find(z => z.id === saved.zoneId); if(z) setZone(z);
                            setAppMode('game');
                        } else setAppMode('create-char');
                    }}>
                        <div className={`throne-icon ${info ? 'occupied' : 'empty'}`}>{info ? '👑' : '🪑'}</div>
                        <div className="slot-info">
                            <div style={{color: '#ffd100', fontSize: '1.2em', fontWeight: 'bold'}}>存档 {i + 1}</div>
                            {info ? (
                                <><div style={{color: '#fff', marginTop: '10px'}}>{info.username}</div>
                                <div style={{color: '#888'}}>Lv{info.level} {classNames[info.class as PlayerClass]}</div>
                                <div style={{color: '#666', fontSize: '10px', marginTop: '5px'}}>{new Date(info.timestamp).toLocaleDateString()}</div></>
                            ) : (<div style={{color: '#666', marginTop: '20px'}}>空闲</div>)}
                        </div>
                    </div>
                );
            })}
          </div>
      </div>
    );
  }

  if (appMode === 'create-char') {
      return (
        <div className="login-screen">
            <div className="login-box">
                <h1 className="login-title">创建新角色</h1>
                <input className="login-input" type="text" placeholder="输入角色名" value={createName} onChange={e => setCreateName(e.target.value)} />
                <div style={{display: 'flex', gap: '10px'}}>
                    <button className="wow-btn secondary" onClick={() => setAppMode('slot-select')}>返回</button>
                    <button className="wow-btn" onClick={() => {
                        if(!createName) return;
                        const newPlayer = IdleWowCore.getBaseStats(1, createName);
                        setPlayer(newPlayer); 
                        setShowWelcomeModal(true); // Always show welcome modal to block game loop
                        setAppMode('game');
                        IdleWowUtil.saveToSlot(currentSlot, { player: newPlayer, equipment: { weapon: null, head: null, chest: null, legs: null }, inventory: [], zoneId: ZONES[0].id });
                    }}>开始冒险</button>
                </div>
            </div>
        </div>
      );
  }

  return (
    <div className="app-container">
      <div id="global-tooltip"></div>

      {showWelcomeModal && (
        <div className="modal-overlay">
            <div className="modal-content god-modal" style={{borderColor: isGod ? 'gold' : '#444', boxShadow: isGod ? '0 0 50px rgba(255, 215, 0, 0.2)' : '0 0 20px rgba(0,0,0,0.8)'}}>
                {isGod ? (
                    <>
                        <h2 style={{color: 'gold', fontFamily: 'KaiTi, serif', fontSize: '24px', marginBottom: '20px'}}>至高神谕</h2>
                        <div style={{color: '#ddd', lineHeight: '1.8', textAlign: 'left', fontSize: '14px', padding: '0 10px'}}>
                            <p>尊敬的 <span style={{color: 'gold', fontWeight: 'bold'}}>{player.username}</span> 阁下：</p>
                            <p>寰宇震颤，星辰低垂。您的降临是这方世界的无上荣光。</p>
                            <p>凡俗的规则无法束缚您的意志，命运的轮盘将随您的心意而转动。</p>
                            <p>特此奉上神之权限，愿您在游历中尽享主宰之乐。</p>
                        </div>
                        <button className="wow-btn" style={{marginTop: '20px', minWidth: '120px', border: '1px solid gold', boxShadow: '0 0 10px gold'}} onClick={() => setShowWelcomeModal(false)}>
                            知晓
                        </button>
                    </>
                ) : (
                    <>
                        <h2 style={{color: '#ffd100', fontSize: '24px', marginBottom: '20px'}}>欢迎来到艾泽拉斯</h2>
                        <div style={{color: '#ddd', lineHeight: '1.8', textAlign: 'left', fontSize: '14px', padding: '0 10px'}}>
                            <p>勇敢的冒险者 <span style={{color: '#fff', fontWeight: 'bold'}}>{player.username}</span>：</p>
                            <p>前方充满了未知的危险与机遇。握紧你的武器，去征服这片狂野的大陆吧！</p>
                            <p style={{color: '#a335ee', marginTop: '15px', fontSize: '12px'}}>
                                <em>注意：死亡并非终结。当你第一次倒下时，古老的【轮回系统】将会觉醒...</em>
                            </p>
                        </div>
                        <button className="wow-btn" style={{marginTop: '20px', minWidth: '120px'}} onClick={() => setShowWelcomeModal(false)}>
                            确定
                        </button>
                    </>
                )}
            </div>
        </div>
      )}
      
      {showReincarnationModal && (
          <div className="modal-overlay">
              <div className="modal-content god-modal" style={{borderColor: '#a335ee', boxShadow: '0 0 50px rgba(163, 53, 238, 0.3)'}}>
                  <h2 style={{color: '#a335ee', fontFamily: 'KaiTi, serif'}}>
                      {isGod ? '真神归位' : '华夏轮回'}
                  </h2>
                  <p style={{lineHeight: '1.6', fontSize: '14px', color: '#ddd'}}>
                      {isGod ? 
                          '尊贵的真神，死亡无法束缚您的意志。轮回系统已为您开启，请使用轮回之力主宰六道。' : 
                          '凡人，死亡并非终结，而是新的开始。你触发了古老的华夏轮回系统，去掌握轮回之力，逆天改命吧。'}
                  </p>
                  <button className="wow-btn" onClick={() => setShowReincarnationModal(false)}>接受命运</button>
              </div>
          </div>
      )}

      {showGodToggleModal && (
          <div className="modal-overlay">
              <div className="modal-content god-modal">
                  <h3 style={{color: 'gold'}}>神之权限</h3>
                  <div style={{marginBottom: '15px'}}>
                      <label style={{display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', color: '#fff'}}>
                          <input type="checkbox" checked={player.godModeAutoEquip || false} onChange={e => setPlayer(p => ({...p, godModeAutoEquip: e.target.checked}))} />
                          自动装备与出售
                      </label>
                  </div>
                  <div style={{marginBottom: '15px'}}>
                      <div style={{color: '#ddd', fontSize: '12px', marginBottom: '5px'}}>游戏速度: {player.gameSpeed}x</div>
                      <input type="range" min="1" max="10" step="1" value={player.gameSpeed || 1} onChange={(e) => setPlayer(p => ({...p, gameSpeed: parseInt(e.target.value)}))} style={{width: '100%'}} />
                  </div>
                  <h4 style={{color: '#aaa', marginTop: '10px'}}>幻化模型</h4>
                  <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '20px'}}>
                      {['player', 'dragon', 'mech', 'beast', 'humanoid'].map(m => (
                          <button key={m} className="wow-btn secondary" onClick={() => setModelOverride(m)}>{m.toUpperCase()}</button>
                      ))}
                  </div>
                  <button className="wow-btn" onClick={() => setShowGodToggleModal(false)}>关闭</button>
              </div>
          </div>
      )}

      {showClassModal && (
          <div className="modal-overlay">
              <div className="modal-content" style={{width: '500px'}}>
                  <h2 style={{color: '#ffd100'}}>选择你的道路</h2>
                  <div style={{display: 'flex', gap: '20px', justifyContent: 'center', margin: '20px 0'}}>
                      <div style={{flex: 1, border: '1px solid #8b0000', padding: '10px', background: '#220000'}}>
                          <h3 style={{color: '#ff3333'}}>战士</h3>
                          <p style={{fontSize: '12px', color: '#ccc'}}>使用怒气，精通近战武器，拥有强大的斩杀能力。</p>
                          <button className="wow-btn" onClick={() => changeClass('warrior')}>成为战士</button>
                      </div>
                      <div style={{flex: 1, border: '1px solid #8a2be2', padding: '10px', background: '#110022'}}>
                          <h3 style={{color: '#a335ee'}}>法师</h3>
                          <p style={{fontSize: '12px', color: '#ccc'}}>使用法力，精通元素魔法，拥有控制和爆发能力。</p>
                          <button className="wow-btn" onClick={() => changeClass('mage')}>成为法师</button>
                      </div>
                  </div>
                  <button className="wow-btn secondary" onClick={() => setShowClassModal(false)}>稍后再选</button>
              </div>
          </div>
      )}

      <div className="hud-header">
         <div className="player-frame">
            <div className={`avatar ${isGod ? 'god-avatar' : ''}`}>{player.username[0]}</div>
            <div className="bars">
                <div style={{color: '#fff', fontWeight: 'bold'}}>{player.username} Lv{player.level} <span style={{fontSize: '0.8em', color: '#aaa'}}>({player.class})</span></div>
                <div className="bar-container">
                    <div className="bar-fill hp-fill" style={{width: `${(player.hp / derivedStats.maxHp)*100}%`}}></div>
                    <div className="bar-text">{Math.floor(player.hp)} / {derivedStats.maxHp} HP</div>
                </div>
                {player.class === 'mage' && (
                    <div className="bar-container">
                        <div className="bar-fill mana-fill" style={{width: `${(player.mana / derivedStats.maxMana)*100}%`}}></div>
                        <div className="bar-text">{Math.floor(player.mana)} / {derivedStats.maxMana} MP</div>
                    </div>
                )}
                {player.class === 'warrior' && (
                    <div className="bar-container">
                        <div className="bar-fill rage-fill" style={{width: `${player.rage}%`}}></div>
                        <div className="bar-text">{Math.floor(player.rage)} / 100 Rage</div>
                    </div>
                )}
                <div className="bar-container" style={{height: '4px'}}>
                    <div className="bar-fill xp-fill" style={{width: `${(player.xp / player.maxXp)*100}%`}}></div>
                </div>
            </div>
         </div>
         <div style={{textAlign: 'right'}}>
             <div className="gold-text">{IdleWowUtil.formatMoney(player.gold)}</div>
             <button className="wow-btn secondary" onClick={() => {IdleWowUtil.saveToSlot(currentSlot, { player, equipment, inventory, zoneId: zone.id }); setAppMode('slot-select');}}>退出</button>
         </div>
      </div>

      <div className="main-content">
          <div className="world-view">
             <CombatScene mobTemplate={combat.mob?.template || null} playerClass={player.class} playerModelOverride={player.modelOverride} playerAttackAnim={combat.pAnim} mobAttackAnim={combat.mAnim} />
             <div className="combat-overlay">
                 {combat.mob ? (
                     <div className="target-frame">
                         <div style={{color: '#ff3333', fontWeight: 'bold'}}>{combat.mob.template.name} Lv{combat.mob.template.level}</div>
                         <div className="bar-container" style={{height: '10px'}}><div className="bar-fill" style={{background: '#ff0000', width: `${(combat.mob.hp / combat.mob.maxHp)*100}%`}}></div></div>
                     </div>
                 ) : <div style={{color: '#aaa', marginTop: '20px'}}>寻找敌人中...</div>}
             </div>
          </div>
          <div className="combat-log">
             {logs.map(log => <div key={log.id} className={`log-entry log-${log.type}`}>[{new Date(log.timestamp).toLocaleTimeString()}] {log.text}</div>)}
          </div>
      </div>

      <div className="bottom-panel">
          <div className="tabs">
              {['char', 'skills', 'shop', 'map'].map(t => (
                  <div key={t} className={`tab ${activeTab === t ? 'active' : ''}`} onClick={() => setActiveTab(t)}>{t === 'char' ? '角色' : t === 'skills' ? '技能' : t === 'shop' ? '商店' : '地图'}</div>
              ))}
              {player.reincarnationUnlocked && (
                  <div className={`tab ${activeTab === 'samsara' ? 'active' : ''}`} style={{color: '#a335ee'}} onClick={() => setActiveTab('samsara')}>轮回</div>
              )}
          </div>
          <div className="tab-content">
              {activeTab === 'char' && (
                  <div className="char-sheet">
                      <div className="stats-block wow-panel" style={{padding: '10px'}}>
                          <div style={{marginBottom: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                              <span style={{color: '#ffd100'}}>属性 {player.furyEnabled && <span style={{color: 'red', fontWeight: 'bold', fontSize: '12px'}}>(狂怒生效中!)</span>}</span>
                              {player.level >= 10 && player.class === 'novice' && <button className="wow-btn" style={{fontSize: '10px'}} onClick={() => setShowClassModal(true)}>转职</button>}
                          </div>
                          
                          {(['str', 'agi', 'int', 'sta'] as StatType[]).map(stat => (
                              <div key={stat} className="stat-row" onMouseEnter={e => showTooltip(e, {str:"提高攻击强度 (AP)。\n每 1 点力量增加 2 点近战攻击强度。", agi:"提高暴击几率。\n每 20 点敏捷增加 1% 暴击率。\n暴击率超过 100% 后，溢出部分转化为暴击伤害。", int:"提高法力值上限。\n每 1 点智力增加 10 点法力值。", sta:"提高生命值上限。\n每 1 点耐力增加 10 点生命值。"}[stat])} onMouseLeave={hideTooltip}>
                                  <div style={{display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center'}}>
                                      <span>{{str:'力量',agi:'敏捷',int:'智力',sta:'耐力'}[stat]}</span>
                                      <div style={{display: 'flex', alignItems: 'center', gap: '5px'}}>
                                          <span style={{color: tempAlloc[stat] > 0 ? '#00ff00' : 'inherit'}}>
                                              {derivedStats[stat]} {tempAlloc[stat] > 0 ? `(+${tempAlloc[stat]})` : ''}
                                          </span>
                                          {pointsAvailable > 0 && player.autoAllocMode === 'manual' && (
                                              <button className="wow-btn" style={{padding: '0 4px', fontSize: '10px', height: '18px'}} onClick={(e) => { e.stopPropagation(); setTempAlloc(p => ({...p, [stat]: p[stat] + 1})); }}>+</button>
                                          )}
                                      </div>
                                  </div>
                              </div>
                          ))}

                          <div style={{marginTop: '15px', borderTop: '1px solid #444', paddingTop: '5px'}}>
                              <div style={{color: '#ffd100', fontSize: '12px', marginBottom: '5px'}}>可用点数: {pointsAvailable}</div>
                              
                              {/* Auto Allocator Selector */}
                              <div style={{marginBottom: '10px'}}>
                                  <select 
                                      value={player.autoAllocMode} 
                                      onChange={(e) => setPlayer(p => ({...p, autoAllocMode: e.target.value as AutoAllocStrategy}))}
                                      style={{width: '100%', background: '#222', color: '#fff', border: '1px solid #555', fontSize: '12px', padding: '5px'}}
                                  >
                                      {Object.entries(AUTO_ALLOC_CN).map(([k, v]) => (
                                          <option key={k} value={k}>{v}</option>
                                      ))}
                                  </select>
                              </div>

                              {tempPointsSpent > 0 && (
                                  <div style={{display: 'flex', gap: '5px'}}>
                                      <button className="wow-btn" style={{flex: 1, fontSize: '12px'}} onClick={confirmStats}>保存加点</button>
                                      <button className="wow-btn secondary" style={{flex: 1, fontSize: '12px'}} onClick={() => setTempAlloc({str:0, agi:0, int:0, sta:0})}>重置</button>
                                  </div>
                              )}
                          </div>

                          <div style={{marginTop: '15px', fontSize: '12px', color: '#888'}}>
                              <div>DPS: {derivedStats.dps.toFixed(1)}</div>
                              <div>暴击率: {(derivedStats.crit * 100).toFixed(2)}%</div>
                              <div>暴击伤害: {(derivedStats.critDmg * 100).toFixed(0)}%</div>
                              {player.reincarnationUnlocked && <div style={{color: '#a335ee'}}>轮回之力: {player.reincarnationPower}</div>}
                          </div>
                      </div>
                      
                      <div style={{flex: 1}}>
                          <div style={{marginBottom: '5px', color: '#888'}}>装备</div>
                          <div style={{display: 'flex', gap: '10px', marginBottom: '20px'}}>
                              {(['head', 'chest', 'legs', 'weapon'] as ItemSlot[]).map(slot => (
                                  <div key={slot} className={`item-slot ${equipment[slot]?.quality || ''}`} onMouseEnter={e => equipment[slot] && showTooltip(e, IdleWowCore.formatItemStats(equipment[slot]!))} onMouseLeave={hideTooltip}>
                                      <div className="item-icon" style={{opacity: equipment[slot] ? 1 : 0.3}}>
                                          {ICONS[slot]}
                                      </div>
                                  </div>
                              ))}
                          </div>
                          <div className="inventory-grid">
                              {inventory.map(item => (
                                  <div key={item.id} className={`item-slot ${item.quality}`} onClick={() => equipItem(item)} onMouseEnter={e => showTooltip(e, IdleWowCore.formatItemStats(item))} onMouseLeave={hideTooltip} onContextMenu={e => {e.preventDefault(); setPlayer(p=>({...p, gold: p.gold+item.value})); setInventory(inv=>inv.filter(i=>i.id!==item.id));}}>
                                      <div className="item-icon">{ICONS[item.slot]}</div>
                                  </div>
                              ))}
                          </div>
                      </div>
                  </div>
              )}
              
              {activeTab === 'skills' && (
                  <div style={{width: '100%'}}>
                      <div style={{display: 'flex', justifyContent: 'space-between', marginBottom: '10px'}}>
                          <span style={{color: '#ffd100'}}>技能点: {player.skillPoints}</span>
                          {isGod && <button className="wow-btn secondary" onClick={() => setShowGodToggleModal(true)}>神之权限</button>}
                      </div>
                      <div style={{display: 'flex', gap: '20px', flexWrap: 'wrap'}}>
                          {Object.values(SKILL_DB).filter(s => s.reqClass === player.class).map(skill => {
                              const rank = player.skills[skill.id] || 0;
                              const currentMult = IdleWowCore.getSkillDamage(skill.id, rank, skill.dmgMult);
                              const nextMult = IdleWowCore.getSkillDamage(skill.id, rank + 1, skill.dmgMult);
                              
                              return (
                                  <div key={skill.id} className="wow-panel" style={{padding: '10px', width: '200px', opacity: player.level >= skill.minLevel ? 1 : 0.5}}>
                                      <div style={{color: '#fff', fontWeight: 'bold'}}>{skill.name} <span style={{fontSize: '10px', color: '#aaa'}}>Lv{rank}</span></div>
                                      <div style={{fontSize: '12px', color: '#aaa', margin: '5px 0'}}>{skill.description}</div>
                                      <div style={{fontSize: '11px', color: '#888'}}>伤害倍率: {(currentMult * 100).toFixed(0)}% {rank > 0 && <span style={{color: '#0f0'}}>&rarr; {(nextMult * 100).toFixed(0)}%</span>}</div>
                                      <div style={{fontSize: '11px', color: skill.costType === 'rage' ? '#ff3333' : '#00ccff'}}>消耗: {skill.costType === 'mana' ? `${skill.cost}% 法力` : `${skill.cost} 怒气`}</div>
                                      {player.skillPoints > 0 && player.level >= skill.minLevel && (
                                          <button className="wow-btn" style={{marginTop: '10px', width: '100%'}} onClick={() => learnSkill(skill.id)}>升级</button>
                                      )}
                                  </div>
                              );
                          })}
                          {player.class === 'novice' && <div style={{color: '#888', padding: '20px'}}>请先达到10级并转职以解锁技能。</div>}
                      </div>
                  </div>
              )}

              {activeTab === 'shop' && (
                  <div className="shop-items">
                      <div className="shop-card" onClick={() => {if(player.gold>=500){setPlayer(p=>({...p, gold: p.gold-500, potions: p.potions+1})); IdleWowAudio.playSfx('loot');}}}>
                          <div className="shop-info"><div className="common-text">治疗药水</div><div className="gold-text">5 银币</div></div>
                          <button className="wow-btn secondary">购买</button>
                      </div>
                      
                      <div className="shop-card" onClick={resetStats}>
                          <div className="shop-info">
                              <div className="rare-text">遗忘药水</div>
                              <div className="gold-text">10 银币</div>
                              <div style={{fontSize: '10px', color: '#888'}}>重置所有属性点</div>
                          </div>
                          <button className="wow-btn secondary">购买</button>
                      </div>

                      <div className="shop-card" onClick={resetSkills}>
                          <div className="shop-info">
                              <div className="rare-text">洗脑药水</div>
                              <div className="gold-text">10 银币</div>
                              <div style={{fontSize: '10px', color: '#888'}}>重置所有技能点</div>
                          </div>
                          <button className="wow-btn secondary">购买</button>
                      </div>

                      <div className="shop-card" onClick={buyMysteryItem}>
                          <div className="shop-info">
                              <div className="epic-text" style={{textShadow: '0 0 5px #a335ee'}}>神秘装备</div>
                              <div className="gold-text">20 银币</div>
                              <div style={{fontSize: '10px', color: '#888'}}>获取一件与你等级相符的装备</div>
                          </div>
                          <button className="wow-btn secondary">购买</button>
                      </div>
                  </div>
              )}

              {activeTab === 'map' && (
                  <div className="zone-list">
                      {ZONES.map(z => (
                          <div key={z.id} className={`zone-card ${zone.id === z.id ? 'active' : ''}`} onClick={() => {
                              if (player.level >= z.minLevel) {
                                  setZone(z); setCombat({mob:null, pAnim:false, mAnim:false});
                              } else {
                                  addLog(`等级不足! 需要等级 ${z.minLevel}`, 'sys');
                              }
                          }}>
                              <div style={{color: player.level >= z.minLevel ? '#ffd100' : '#555'}}>{z.name}</div>
                              <div style={{color: '#888'}}>Lv{z.minLevel}-{z.maxLevel}</div>
                          </div>
                      ))}
                  </div>
              )}

              {activeTab === 'samsara' && (
                  <div style={{width: '100%'}}>
                      <div style={{textAlign: 'center', marginBottom: '20px', padding: '10px', borderBottom: '1px solid #333'}}>
                          <div style={{fontSize: '18px', color: '#aaa'}}>轮回之力: <span style={{color: '#fff', fontSize: '24px'}}>{player.reincarnationPower}</span></div>
                          <div style={{fontSize: '18px', color: '#a335ee'}}>六道轮回之力: <span style={{color: '#fff', fontSize: '24px'}}>{player.sixPathsPower}</span></div>
                          
                          <div style={{marginTop: '15px'}}>
                              <button className="wow-btn" style={{background: 'linear-gradient(to bottom, #440000 0%, #220000 100%)', borderColor: '#ff0000'}} onClick={activateFury} disabled={player.reincarnationPower < 10}>
                                  开启狂怒 (消耗10点轮回之力)
                              </button>
                              <div style={{fontSize: '12px', color: '#888', marginTop: '5px'}}>
                                  消耗10点轮回之力，获得1点六道轮回之力，并使下一场战斗全属性翻倍。
                              </div>
                          </div>
                      </div>

                      <h3 style={{color: '#a335ee', borderBottom: '1px solid #444', paddingBottom: '5px'}}>武侠内功</h3>
                      <div style={{display: 'flex', gap: '15px', flexWrap: 'wrap'}}>
                          {MARTIAL_ARTS_DB.map(art => {
                              const owned = player.passiveArts.includes(art.id);
                              return (
                                  <div key={art.id} className={`wow-panel ${owned ? 'owned' : ''}`} style={{padding: '15px', width: '220px', borderColor: owned ? '#0f0' : '#a335ee'}}>
                                      <div style={{color: owned ? '#0f0' : '#d28eff', fontWeight: 'bold', fontSize: '16px'}}>{art.name}</div>
                                      <div style={{color: '#aaa', fontSize: '12px', marginBottom: '10px', fontStyle: 'italic'}}>{art.desc}</div>
                                      <div style={{fontSize: '12px', color: '#fff'}}>
                                          {Object.entries(art.stats).map(([k, v]) => <div key={k}>+{v} {k === 'str' ? '力量' : k === 'agi' ? '敏捷' : k === 'int' ? '智力' : '耐力'}</div>)}
                                      </div>
                                      <div style={{marginTop: '10px', paddingTop: '10px', borderTop: '1px solid #333'}}>
                                          {owned ? (
                                              <div style={{color: '#0f0', textAlign: 'center'}}>已习得</div>
                                          ) : (
                                              <button className="wow-btn secondary" style={{width: '100%'}} onClick={() => buyMartialArt(art)} disabled={player.sixPathsPower < art.cost}>
                                                  参悟 (消耗 {art.cost} 六道之力)
                                              </button>
                                          )}
                                      </div>
                                  </div>
                              );
                          })}
                      </div>
                  </div>
              )}
          </div>
      </div>
    </div>
  );
};

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
