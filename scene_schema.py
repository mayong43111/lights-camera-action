import copy
import math
import re


CATEGORIES = ('时尚封面', '写真集', '肖像', '其他')
ASPECTS = ('1.5', '1.333333', '1', '0.5625')
ANALYSIS_JOINTS = ['root', 'torso', 'chest', 'neck', 'head'] + [
    side + part for side in ('left', 'right')
    for part in ('Shoulder', 'UpperArm', 'LowerArm', 'Hand', 'UpperLeg', 'LowerLeg', 'Foot', 'Toes')
]
HINGES = {'leftLowerArm': (1, -1), 'rightLowerArm': (1, 1),
          'leftLowerLeg': (0, 1), 'rightLowerLeg': (0, 1)}
JOINT_NAMES = ['root', 'torso', 'chest', 'neck', 'head']
for side in ('left', 'right'):
    JOINT_NAMES.extend(side + part for part in ('Shoulder', 'UpperArm', 'LowerArm', 'Hand', 'UpperLeg', 'LowerLeg', 'Foot', 'Toes'))
    for finger in ('Thumb', 'Index', 'Middle', 'Ring', 'Little'):
        segments = ('Metacarpal', 'Proximal', 'Distal') if finger == 'Thumb' else ('Proximal', 'Intermediate', 'Distal')
        JOINT_NAMES.extend(side + finger + segment for segment in segments)


def analysis_response_format():
    def object_schema(properties):
        return {'type': 'object', 'properties': properties, 'required': list(properties), 'additionalProperties': False}

    numeric = {'type': 'number'}
    string = {'type': 'string'}
    boolean = {'type': 'boolean'}
    angles = {'type': 'array', 'items': numeric}
    light = object_schema({'enabled': boolean, 'intensity': numeric, 'color': string,
                           'position': numeric, 'height': numeric, 'depth': numeric})
    prop = object_schema({'type': {'type': 'string', 'enum': ['flowers', 'sword', 'gun', 'block']},
                          'position': angles, 'rotation': angles, 'size': angles, 'color': string})
    pose = object_schema({
        'format': {'type': 'string', 'enum': ['studio-pose']},
        'version': {'type': 'integer', 'enum': [1]},
        'units': {'type': 'string', 'enum': ['radians']},
        'rotation': numeric,
        'placement': object_schema({'grounded': boolean, 'height': numeric}),
        'joints': object_schema({name: numeric if name in HINGES else angles for name in ANALYSIS_JOINTS}),
    })
    scene = object_schema({
        'jointPose': pose, 'cameraPosition': angles, 'target': angles, 'focal': numeric,
        'aspect': {'type': 'string', 'enum': list(ASPECTS)}, 'exposure': numeric,
        'backdrop': {'type': 'string', 'enum': ['#eef2f4']}, 'props': {'type': 'array', 'items': prop},
        'lights': object_schema({name: light for name in ('key', 'fill', 'rim')}),
    })
    schema = object_schema({
        'personCount': {'type': 'integer'},
        'name': string,
        'category': {'type': 'string', 'enum': list(CATEGORIES)},
        'notes': string,
        'scene': {'anyOf': [scene, {'type': 'null'}]},
    })
    return {'type': 'json_schema', 'json_schema': {'name': 'studio_reference', 'strict': True, 'schema': schema}}


def decode_analysis_scene(scene):
    result = copy.deepcopy(scene)
    joints = result['jointPose']['joints']
    for name, (axis, sign) in HINGES.items():
        if name not in joints:
            continue
        bend = joints[name]
        if not number(bend, 0, 2.65):
            raise ValueError('Invalid hinge flexion')
        angles = [0, 0, 0]
        angles[axis] = bend * sign
        joints[name] = angles
    result['backdrop'] = '#eef2f4'
    return result


def number(value, low, high):
    return type(value) in (int, float) and low <= value <= high and math.isfinite(value)


def vector(value, low, high):
    return isinstance(value, list) and len(value) == 3 and all(number(item, low, high) for item in value)


def color(value):
    return isinstance(value, str) and re.fullmatch(r'#[0-9a-fA-F]{6}', value) is not None


def text(value, limit):
    return isinstance(value, str) and 0 < len(value.strip()) <= limit and not any(ord(char) < 32 and char not in '\n\t' for char in value)


def valid_scene(scene):
    if not isinstance(scene, dict) or set(scene) != {'jointPose', 'cameraPosition', 'target', 'focal', 'aspect', 'exposure', 'backdrop', 'props', 'lights'}:
        return False
    pose = scene['jointPose']
    if not isinstance(pose, dict) or set(pose) != {'format', 'version', 'units', 'rotation', 'placement', 'joints'}:
        return False
    if pose['format'] != 'studio-pose' or type(pose['version']) is not int or pose['version'] != 1 or pose['units'] != 'radians' or not number(pose['rotation'], -math.pi, math.pi):
        return False
    placement = pose['placement']
    if not isinstance(placement, dict) or set(placement) != {'grounded', 'height'} or type(placement['grounded']) is not bool or not number(placement['height'], -20, 20):
        return False
    joints = pose['joints']
    if not isinstance(joints, dict) or not joints or not set(joints).issubset(JOINT_NAMES) or not all(vector(angles, -math.pi, math.pi) for angles in joints.values()):
        return False
    if not vector(scene['cameraPosition'], -100, 100) or not vector(scene['target'], -20, 20):
        return False
    if math.dist(scene['cameraPosition'], scene['target']) < 0.1:
        return False
    if not number(scene['focal'], 24, 100) or scene['aspect'] not in ASPECTS or not number(scene['exposure'], 0.125, 2) or not color(scene['backdrop']):
        return False
    props = scene['props']
    if not isinstance(props, list) or len(props) > 16:
        return False
    for prop in props:
        if not isinstance(prop, dict) or set(prop) != {'type', 'position', 'rotation', 'size', 'color'}:
            return False
        if prop['type'] not in ('flowers', 'sword', 'gun', 'block') or not vector(prop['position'], -20, 20) or not vector(prop['rotation'], -math.pi, math.pi) or not vector(prop['size'], 0.02, 10) or not color(prop['color']):
            return False
    lights = scene['lights']
    if not isinstance(lights, dict) or set(lights) != {'key', 'fill', 'rim'}:
        return False
    for light in lights.values():
        if not isinstance(light, dict) or set(light) != {'enabled', 'intensity', 'color', 'position', 'height', 'depth'}:
            return False
        if type(light['enabled']) is not bool or not color(light['color']) or not number(light['intensity'], 0, 12) or not number(light['position'], -6, 6) or not number(light['height'], 1, 6) or not number(light['depth'], -4, 6):
            return False
    return True


def valid_preset(preset):
    if not isinstance(preset, dict) or set(preset) != {'id', 'name', 'category', 'notes', 'sourceName', 'scene', 'thumbnail'}:
        return False
    thumbnail = preset['thumbnail']
    return (isinstance(preset['id'], str) and re.fullmatch(r'shot-[a-f0-9]{32}', preset['id']) is not None
            and text(preset['name'], 80) and preset['category'] in CATEGORIES and text(preset['notes'], 1200)
            and text(preset['sourceName'], 160) and valid_scene(preset['scene'])
            and isinstance(thumbnail, str) and len(thumbnail) <= 200_000
            and re.fullmatch(r'data:image/jpeg;base64,[A-Za-z0-9+/=]+', thumbnail) is not None)