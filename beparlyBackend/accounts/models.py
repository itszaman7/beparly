import hashlib
import re
import secrets
from datetime import timedelta

from django.contrib.auth.models import AbstractUser, BaseUserManager
from django.core.exceptions import ValidationError
from django.db import models
from django.utils import timezone


def normalize_phone(value):
    digits = re.sub(r'[\s().-]', '', str(value))
    if digits.startswith('+880'):
        digits = '0' + digits[4:]
    elif digits.startswith('880'):
        digits = '0' + digits[3:]
    if not re.fullmatch(r'01[3-9]\d{8}', digits):
        raise ValidationError('Enter a valid Bangladeshi mobile number.')
    return digits


class UserManager(BaseUserManager):
    def create_user(self, phone, password=None, **extra_fields):
        user = self.model(phone=normalize_phone(phone), **extra_fields)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_superuser(self, phone, password, **extra_fields):
        extra_fields.setdefault('is_staff', True)
        extra_fields.setdefault('is_superuser', True)
        if not extra_fields['is_staff'] or not extra_fields['is_superuser']:
            raise ValueError('Superuser must have is_staff and is_superuser set.')
        return self.create_user(phone, password, **extra_fields)


class User(AbstractUser):
    username = None
    phone = models.CharField(max_length=11, unique=True)
    first_name = models.CharField(max_length=150, blank=True)
    last_name = models.CharField(max_length=150, blank=True)

    USERNAME_FIELD = 'phone'
    REQUIRED_FIELDS = []
    objects = UserManager()

    def __str__(self):
        return self.phone


class Business(models.Model):
    name = models.CharField(max_length=160)
    phone = models.CharField(max_length=20, blank=True)
    address = models.CharField(max_length=255, blank=True)
    logo = models.ImageField(upload_to='business_logos/', blank=True, null=True)
    timezone = models.CharField(max_length=64, default='Asia/Dhaka')
    expiry_warning_days = models.PositiveSmallIntegerField(default=30)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.name


class BusinessMember(models.Model):
    OWNER = 'owner'
    EMPLOYEE = 'employee'
    ROLE_CHOICES = [(OWNER, 'Owner'), (EMPLOYEE, 'Employee')]

    business = models.ForeignKey(Business, on_delete=models.PROTECT, related_name='members')
    user = models.ForeignKey(User, on_delete=models.PROTECT, related_name='memberships')
    role = models.CharField(max_length=12, choices=ROLE_CHOICES)
    can_manage_locations = models.BooleanField(default=True)
    can_post_stock = models.BooleanField(default=True)
    can_manage_purchases = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['business', 'user'], name='unique_business_member')]


class AuthSession(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='auth_sessions')
    token_hash = models.CharField(max_length=64, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    revoked_at = models.DateTimeField(null=True, blank=True)

    @classmethod
    def issue(cls, user):
        token = secrets.token_urlsafe(48)
        cls.objects.create(
            user=user,
            token_hash=hashlib.sha256(token.encode()).hexdigest(),
            expires_at=timezone.now() + timedelta(days=30),
        )
        return token
