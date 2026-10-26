from django.contrib import admin
from django.contrib.auth.admin import UserAdmin
from django.contrib.auth.password_validation import validate_password
from django import forms
from django.core.exceptions import ValidationError

from .models import AuthSession, Business, BusinessMember, User, normalize_phone


class AdminUserAddForm(forms.ModelForm):
    phone = forms.CharField(max_length=24, help_text='Bangladeshi mobile number, for example 01812345678 or +8801812345678.')
    business = forms.ModelChoiceField(queryset=Business.objects.all(), help_text='Business this person can sign in to.')
    role = forms.ChoiceField(choices=BusinessMember.ROLE_CHOICES, initial=BusinessMember.OWNER)
    password1 = forms.CharField(label='Password', widget=forms.PasswordInput)
    password2 = forms.CharField(label='Confirm password', widget=forms.PasswordInput)

    class Meta:
        model = User
        fields = ('phone', 'first_name', 'last_name')

    def clean_phone(self):
        phone = normalize_phone(self.cleaned_data['phone'])
        if User.objects.filter(phone=phone).exists():
            raise forms.ValidationError('A user with this phone number already exists.')
        return phone

    def clean(self):
        data = super().clean()
        if data.get('password1') and data.get('password2') and data['password1'] != data['password2']:
            self.add_error('password2', 'Passwords do not match.')
        if data.get('password1'):
            try:
                validate_password(data['password1'], User(phone=data.get('phone', ''), first_name=data.get('first_name', '')))
            except ValidationError as exc:
                self.add_error('password1', exc)
        return data

    def save(self, commit=True):
        user = super().save(commit=False)
        user.set_password(self.cleaned_data['password1'])
        if commit:
            user.save()
        return user


class BusinessMemberInline(admin.TabularInline):
    model = BusinessMember
    extra = 0
    autocomplete_fields = ('business',)


class BusinessOwnerForm(forms.ModelForm):
    owner = forms.ModelChoiceField(queryset=User.objects.filter(is_active=True), required=False,
                                   help_text='Optional. If the owner is new, create the business first, then add a user and select this business.')

    class Meta:
        model = Business
        fields = '__all__'


@admin.register(User)
class AccountAdmin(UserAdmin):
    add_form = AdminUserAddForm
    inlines = (BusinessMemberInline,)
    list_display = ('phone', 'first_name', 'businesses', 'is_active', 'is_staff')
    search_fields = ('phone', 'first_name', 'memberships__business__name')
    ordering = ('phone',)
    fieldsets = (
        (None, {'fields': ('phone', 'password')}),
        ('Personal information', {'fields': ('first_name', 'last_name', 'email')}),
        ('Permissions', {'fields': ('is_active', 'is_staff', 'is_superuser', 'groups', 'user_permissions')}),
        ('Important dates', {'fields': ('last_login', 'date_joined')}),
    )
    add_fieldsets = (
        (None, {'fields': ('phone', 'first_name', 'last_name', 'business', 'role', 'password1', 'password2')}),
    )

    @admin.display(description='Businesses')
    def businesses(self, obj):
        return ', '.join(member.business.name for member in obj.memberships.select_related('business').all())

    def get_inline_instances(self, request, obj=None):
        return [] if obj is None else super().get_inline_instances(request, obj)

    def save_related(self, request, form, formsets, change):
        super().save_related(request, form, formsets, change)
        if not change:
            BusinessMember.objects.create(user=form.instance, business=form.cleaned_data['business'],
                                          role=form.cleaned_data['role'])


@admin.register(Business)
class BusinessAdmin(admin.ModelAdmin):
    form = BusinessOwnerForm
    list_display = ('name', 'owner_names', 'created_at')
    search_fields = ('name', 'members__user__phone')
    inlines = (BusinessMemberInline,)

    def get_fieldsets(self, request, obj=None):
        if obj is None:
            return ((None, {'fields': ('name', 'owner', 'phone', 'address')}),)
        return (
            (None, {'fields': ('name', 'phone', 'address', 'timezone')}),
            ('Documents', {'fields': ('invoice_paper', 'receipt_paper', 'logo', 'invoice_footer_text', 'label_print_settings', 'show_currency_symbol')}),
            ('Inventory', {'fields': ('expiry_warning_days',)}),
        )

    @admin.display(description='Owners')
    def owner_names(self, obj):
        return ', '.join(member.user.phone for member in obj.members.select_related('user').filter(role=BusinessMember.OWNER))

    def get_inline_instances(self, request, obj=None):
        return [] if obj is None else super().get_inline_instances(request, obj)

    def save_model(self, request, obj, form, change):
        super().save_model(request, obj, form, change)
        if not change:
            from accounting.services import setup_business
            setup_business(obj)

    def save_related(self, request, form, formsets, change):
        super().save_related(request, form, formsets, change)
        if not change and form.cleaned_data.get('owner'):
            BusinessMember.objects.create(business=form.instance, user=form.cleaned_data['owner'],
                                          role=BusinessMember.OWNER)


@admin.register(BusinessMember)
class BusinessMemberAdmin(admin.ModelAdmin):
    list_display = ('business', 'user', 'role', 'can_manage_locations', 'created_at')
    list_filter = ('role',)
    search_fields = ('business__name', 'user__phone')


@admin.register(AuthSession)
class AuthSessionAdmin(admin.ModelAdmin):
    list_display = ('user', 'created_at', 'expires_at', 'revoked_at')
    readonly_fields = ('user', 'token_hash', 'created_at', 'expires_at', 'revoked_at')
    search_fields = ('user__phone',)

    def has_add_permission(self, request):
        return False
